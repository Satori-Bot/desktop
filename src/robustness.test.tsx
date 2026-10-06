import { MantineProvider } from "@mantine/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureCalls, fixtureSnapshot } from "./test/fixtures";
import type { Activity, Logs, Snapshot, Workspace } from "./types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let snapshot: Snapshot;
let clipboard: ReturnType<typeof vi.fn>;
const count = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).length;

async function defaultInvoke(command: string, args?: Record<string, unknown>) {
  if (command === "snapshot") return structuredClone(snapshot);
  if (command === "activity") return structuredClone(fixtureCalls);
  if (command === "logs")
    return { text: "Initial log output\n", cursor: 10, truncated: false };
  if (command === "connection_config") return "private fixture config";
  if (command === "save_workspace") {
    const saved = structuredClone(args?.workspace as Workspace);
    snapshot.workspaces = snapshot.workspaces.map((workspace) =>
      workspace.id === saved.id ? saved : workspace,
    );
    return saved;
  }
  if (command === "start_workspace") {
    const index = snapshot.statuses.findIndex(
      (status) => status.workspaceId === args?.id,
    );
    snapshot.statuses[index] = {
      ...snapshot.statuses[index],
      state: "running",
      pid: 4242,
      localState: "online",
      localEndpoint: "http://127.0.0.1:8765/mcp",
    };
    return snapshot.statuses[index];
  }
  if (command === "delete_workspace") {
    snapshot.workspaces = snapshot.workspaces.filter((w) => w.id !== args?.id);
    snapshot.statuses = snapshot.statuses.filter(
      (status) => status.workspaceId !== args?.id,
    );
  }
  return null;
}

async function mount() {
  await act(async () => {
    render(
      <MantineProvider env="test" forceColorScheme="light">
        <App />
      </MantineProvider>,
    );
  });
}

async function navigate(name: string) {
  await act(async () => {
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name }),
    );
  });
}

async function tick(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function addSecondWorkspace() {
  snapshot.workspaces.push({
    ...snapshot.workspaces[0],
    id: "birch-workspace",
    name: "Birch workspace",
    path: "/test-fixtures/birch",
    port: 8766,
  });
  snapshot.statuses.push({
    ...snapshot.statuses[0],
    workspaceId: "birch-workspace",
    localEndpoint: "http://127.0.0.1:8766/mcp",
  });
}

async function switchWorkspace() {
  fireEvent.click(screen.getByRole("textbox", { name: "Choose workspace" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: "Birch workspace" }));
  });
  expect(
    screen.getByRole("heading", { name: "Birch workspace" }),
  ).toBeInTheDocument();
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  snapshot = fixtureSnapshot();
  invoke.mockReset();
  invoke.mockImplementation(defaultInvoke);
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("desktop interrupted and delayed IPC flows", () => {
  it("discloses clipping when incremental output exceeds the UI log buffer", async () => {
    let reads = 0;
    invoke.mockImplementation((command, args) => {
      if (command === "logs") {
        reads += 1;
        return Promise.resolve({
          text: reads === 1 ? "A".repeat(60000) : "B".repeat(60000),
          cursor: reads * 60000,
          truncated: false,
        });
      }
      return defaultInvoke(command, args);
    });
    await mount();
    await navigate("Diagnostics");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh logs" })),
    );
    expect(document.querySelector(".log-output")?.textContent?.length).toBe(
      100000,
    );
    expect(
      screen.getByText(
        "Log output was truncated or restarted. Showing the latest available segment.",
      ),
    ).toBeInTheDocument();
  });

  it("discloses a temporary backend refresh failure and recovers without losing the workspace", async () => {
    let disconnected = false;
    invoke.mockImplementation((command, args) => {
      if (command === "snapshot" && disconnected)
        return Promise.reject(
          new Error("Fixture bridge temporarily unavailable"),
        );
      return defaultInvoke(command, args);
    });
    await mount();
    disconnected = true;
    await tick(4000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to refresh status",
    );
    expect(
      screen.getByRole("heading", { name: "Atlas workspace" }),
    ).toBeInTheDocument();
    disconnected = false;
    await tick(4000);
    expect(
      screen.queryByText("Fixture bridge temporarily unavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop workspace" }),
    ).toBeEnabled();
  });

  it.each([
    {
      language: "en" as const,
      navigation: "Connections",
      note: "After restarting or upgrading the core, reconnect your MCP client. If authorization fails, remove this server's saved authorization in the client and sign in again using the password from Show credentials.",
    },
    {
      language: "zh" as const,
      navigation: "连接",
      note: "重启或升级核心后，请重新连接 MCP 客户端。如果授权失败，请移除该服务器在客户端中的已保存授权，并使用“显示凭据”中的密码重新登录。",
    },
  ])(
    "explains OAuth restart reauthorization in $language",
    async ({ language, navigation, note }) => {
      snapshot.settings.language = language;
      snapshot.workspaces[0].auth = "oauth";
      snapshot.workspaces[0].access = "named";
      snapshot.workspaces[0].publicUrl = "https://fixture.example.com";
      await mount();
      await navigate(navigation);
      expect(screen.getByText(note)).toBeInTheDocument();
      expect(count("auth_details")).toBe(0);
    },
  );

  it("does not overlap slow snapshot polls or starve the initial successful response", async () => {
    const first = deferred<Snapshot>();
    invoke.mockImplementation((command, args) =>
      command === "snapshot" ? first.promise : defaultInvoke(command, args),
    );
    await mount();
    await tick(12000);
    expect(count("snapshot")).toBe(1);
    await act(async () => first.resolve(structuredClone(snapshot)));
    expect(
      screen.getByRole("heading", { name: "Atlas workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Loading your workspaces…"),
    ).not.toBeInTheDocument();
  });

  it("does not overlap slow activity polls or discard their first successful response", async () => {
    const first = deferred<Activity[]>();
    invoke.mockImplementation((command, args) =>
      command === "activity" ? first.promise : defaultInvoke(command, args),
    );
    await mount();
    await tick(11000);
    expect(count("activity")).toBe(1);
    await act(async () => first.resolve(structuredClone(fixtureCalls)));
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("refreshes after a mutation without letting an older poll restore stale status", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    const beforeStart = structuredClone(snapshot);
    const oldPoll = deferred<Snapshot>();
    let snapshots = 0;
    invoke.mockImplementation((command, args) => {
      if (command === "snapshot" && ++snapshots === 2) return oldPoll.promise;
      return defaultInvoke(command, args);
    });
    await mount();
    await tick(4000);
    expect(count("snapshot")).toBe(2);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Start workspace" })),
    );
    expect(count("start_workspace")).toBe(1);
    expect(
      screen.getByRole("button", { name: "Stop workspace" }),
    ).toBeEnabled();
    await act(async () => oldPoll.resolve(beforeStart));
    expect(
      screen.getByRole("button", { name: "Stop workspace" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Start workspace" }),
    ).not.toBeInTheDocument();
  });

  it("ignores delayed activity from the previous process after the selected workspace restarts", async () => {
    const previousProcess = deferred<Activity[]>();
    let activityReads = 0;
    invoke.mockImplementation((command, args) => {
      if (command === "activity") {
        activityReads += 1;
        return activityReads === 1
          ? previousProcess.promise
          : Promise.resolve([{ ...fixtureCalls[0], tool: "new_process_call" }]);
      }
      return defaultInvoke(command, args);
    });
    await mount();
    expect(count("activity")).toBe(1);
    snapshot.statuses[0].pid = 8989;
    await tick(4000);
    expect(screen.getByText("new_process_call")).toBeInTheDocument();
    await act(async () =>
      previousProcess.resolve([
        { ...fixtureCalls[0], tool: "previous_process_call" },
      ]),
    );
    expect(screen.getByText("new_process_call")).toBeInTheDocument();
    expect(screen.queryByText("previous_process_call")).not.toBeInTheDocument();
  });

  it("does not copy a credential-bearing configuration after navigating away", async () => {
    const config = deferred<string>();
    invoke.mockImplementation((command, args) =>
      command === "connection_config"
        ? config.promise
        : defaultInvoke(command, args),
    );
    await mount();
    await navigate("Connections");
    fireEvent.click(screen.getAllByRole("button", { name: "Copy config" })[0]);
    expect(count("connection_config")).toBe(1);
    await navigate("Dashboard");
    await act(async () =>
      config.resolve("fixture credential must stay private"),
    );
    expect(clipboard).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Copied", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("does not retarget an approved removal when polling replaces the selected workspace", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    addSecondWorkspace();
    await mount();
    await navigate("Connections");
    fireEvent.click(screen.getByRole("button", { name: "Remove workspace" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Remove this workspace?" }),
    );
    snapshot.workspaces = snapshot.workspaces.slice(1);
    snapshot.statuses = snapshot.statuses.slice(1);
    await tick(8000);
    expect(
      screen.getByRole("heading", { name: "Birch workspace" }),
    ).toBeInTheDocument();
    const confirm = screen.queryByRole("button", {
      name: "Remove",
    });
    if (confirm && !(confirm as HTMLButtonElement).disabled) {
      await act(async () => fireEvent.click(confirm));
    }
    expect(count("delete_workspace")).toBe(0);
    expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual([
      "birch-workspace",
    ]);
  });

  it("replaces discontinuous log output instead of appending across rotation", async () => {
    const responses: Logs[] = [
      { text: "Previous process output\n", cursor: 100, truncated: false },
      { text: "Rotated process output\n", cursor: 200, truncated: true },
      { text: "", cursor: 200, truncated: false },
    ];
    invoke.mockImplementation((command, args) =>
      command === "logs"
        ? Promise.resolve(responses.shift())
        : defaultInvoke(command, args),
    );
    await mount();
    await navigate("Diagnostics");
    expect(screen.getByText("Previous process output")).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh logs" })),
    );
    expect(screen.getByText("Rotated process output")).toBeInTheDocument();
    expect(
      screen.queryByText(/Previous process output/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Log output was truncated or restarted. Showing the latest available segment.",
      ),
    ).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh logs" })),
    );
    expect(screen.getByText("Rotated process output")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Log output was truncated or restarted. Showing the latest available segment.",
      ),
    ).toBeInTheDocument();
  });

  it.each(["success", "failure"])(
    "ignores an old log request's late %s after switching log tabs",
    async (outcome) => {
      const old = deferred<Logs>();
      invoke.mockImplementation((command, args) => {
        if (command === "logs")
          return args?.kind === "runtime"
            ? old.promise
            : Promise.resolve({
                text: "Current tunnel output\n",
                cursor: 20,
                truncated: false,
              });
        return defaultInvoke(command, args);
      });
      await mount();
      await navigate("Diagnostics");
      await act(async () =>
        fireEvent.click(screen.getByRole("radio", { name: "Tunnel logs" })),
      );
      expect(screen.getByText("Current tunnel output")).toBeInTheDocument();
      await act(async () => {
        if (outcome === "success")
          old.resolve({
            text: "Stale runtime output\n",
            cursor: 30,
            truncated: true,
          });
        else old.reject(new Error("Stale runtime failure"));
      });
      expect(screen.getByText("Current tunnel output")).toBeInTheDocument();
      expect(screen.queryByText(/Stale runtime/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refresh logs" }),
      ).toBeEnabled();
    },
  );

  it("clears saved runtime arguments when returning to the managed core", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    snapshot.workspaces[0].coreCommand = [
      "/old/core",
      "--project",
      "/old/path",
    ];
    await mount();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: "" },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save runtime selection" }),
      ),
    );
    expect(snapshot.workspaces[0].coreCommand).toEqual([]);
    expect(screen.getByLabelText("Arguments (one per line)")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
  });

  it("shows the saved canonical runtime arguments and clears dirty state after normalization", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    await mount();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: " /new/core " },
    });
    fireEvent.change(screen.getByLabelText("Arguments (one per line)"), {
      target: { value: "\n--project\n\n/path with spaces\n" },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save runtime selection" }),
      ),
    );
    expect(snapshot.workspaces[0].coreCommand).toEqual([
      "/new/core",
      "--project",
      "/path with spaces",
    ]);
    expect(screen.getByLabelText("Executable path")).toHaveValue("/new/core");
    expect(screen.getByLabelText("Arguments (one per line)")).toHaveValue(
      "--project\n/path with spaces",
    );
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
  });

  it("clears the previous stream's error while the newly selected log stream is pending", async () => {
    const tunnel = deferred<Logs>();
    invoke.mockImplementation((command, args) => {
      if (command === "logs")
        return args?.kind === "runtime"
          ? Promise.reject(new Error("Previous runtime read failed"))
          : tunnel.promise;
      return defaultInvoke(command, args);
    });
    await mount();
    await navigate("Diagnostics");
    expect(
      screen.getByText("Previous runtime read failed"),
    ).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("radio", { name: "Tunnel logs" })),
    );
    expect(
      screen.queryByText("Previous runtime read failed"),
    ).not.toBeInTheDocument();
    await act(async () =>
      tunnel.resolve({
        text: "New tunnel output\n",
        cursor: 60,
        truncated: false,
      }),
    );
    expect(screen.getByText("New tunnel output")).toBeInTheDocument();
  });

  it("clears accumulated log output when the backend resets a deleted log's cursor", async () => {
    const responses: Logs[] = [
      { text: "Deleted log contents\n", cursor: 100, truncated: false },
      { text: "", cursor: 0, truncated: false },
      { text: "Replacement log contents\n", cursor: 30, truncated: false },
    ];
    invoke.mockImplementation((command, args) =>
      command === "logs"
        ? Promise.resolve(responses.shift())
        : defaultInvoke(command, args),
    );
    await mount();
    await navigate("Diagnostics");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh logs" })),
    );
    expect(screen.queryByText(/Deleted log contents/)).not.toBeInTheDocument();
    expect(screen.getByText("No logs available")).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh logs" })),
    );
    expect(screen.getByText("Replacement log contents")).toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith("logs", {
      id: "test-workspace",
      kind: "runtime",
      cursor: 0,
    });
  });

  it("ignores old workspace logs after switching workspaces", async () => {
    addSecondWorkspace();
    const old = deferred<Logs>();
    invoke.mockImplementation((command, args) => {
      if (command === "logs")
        return args?.id === "test-workspace"
          ? old.promise
          : Promise.resolve({
              text: "Birch log output\n",
              cursor: 40,
              truncated: false,
            });
      return defaultInvoke(command, args);
    });
    await mount();
    await navigate("Diagnostics");
    await switchWorkspace();
    expect(screen.getByText("Birch log output")).toBeInTheDocument();
    await act(async () =>
      old.resolve({
        text: "Atlas stale log output\n",
        cursor: 50,
        truncated: false,
      }),
    );
    expect(screen.getByText("Birch log output")).toBeInTheDocument();
    expect(
      screen.queryByText(/Atlas stale log output/),
    ).not.toBeInTheDocument();
  });

  it.each(["success", "failure"])(
    "ignores an old activity request's late %s after switching workspaces",
    async (outcome) => {
      addSecondWorkspace();
      const old = deferred<Activity[]>();
      invoke.mockImplementation((command, args) => {
        if (command === "activity")
          return args?.id === "test-workspace"
            ? old.promise
            : Promise.resolve([
                { ...fixtureCalls[0], tool: "birch_current_call" },
              ]);
        return defaultInvoke(command, args);
      });
      await mount();
      await switchWorkspace();
      expect(screen.getByText("birch_current_call")).toBeInTheDocument();
      await act(async () => {
        if (outcome === "success")
          old.resolve([{ ...fixtureCalls[0], tool: "atlas_stale_call" }]);
        else old.reject(new Error("Stale Atlas activity failure"));
      });
      expect(screen.getByText("birch_current_call")).toBeInTheDocument();
      expect(screen.queryByText("atlas_stale_call")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Stale Atlas activity failure"),
      ).not.toBeInTheDocument();
    },
  );
});
