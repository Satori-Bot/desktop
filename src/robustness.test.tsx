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
import { WorkspaceModal } from "./components/WorkspaceModal";
import { translator } from "./i18n";
import { fixtureCalls, fixtureSnapshot } from "./test/fixtures";
import type { Activity, Logs, Settings, Snapshot, Workspace } from "./types";

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
  if (command === "save_settings") {
    snapshot.settings = structuredClone(args?.settings as Settings);
    return snapshot.settings;
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
      within(screen.getByRole("navigation")).getByRole("button", { name }),
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

describe("saved drafts and accessible history", () => {
  it.each(["en", "zh"] as const)(
    "distinguishes interrupted history from live calls and exposes table cells in %s",
    async (language) => {
      snapshot.settings.language = language;
      invoke.mockImplementation((command, args) =>
        command === "activity"
          ? Promise.resolve([
              ...fixtureCalls,
              {
                ...fixtureCalls[2],
                id: "interrupted-call",
                tool: "previous_process_tool",
                outcome: "interrupted",
              },
            ])
          : defaultInvoke(command, args),
      );
      await mount();
      const table = screen.getByRole("table");
      const interruptedRow = within(table)
        .getByText("previous_process_tool")
        .closest('[role="row"]')!;
      expect(interruptedRow).toHaveTextContent(
        language === "zh" ? "已中断" : "Interrupted",
      );
      expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
      expect(
        within(interruptedRow as HTMLElement).getAllByRole("cell"),
      ).toHaveLength(4);
      await navigate(language === "zh" ? "工具调用" : "Activity");
      const outcomes = screen.getByRole("textbox", {
        name: language === "zh" ? "所有结果" : "All outcomes",
      });
      fireEvent.click(outcomes);
      await act(async () =>
        fireEvent.click(
          screen.getByRole("option", {
            name: language === "zh" ? "进行中" : "In progress",
          }),
        ),
      );
      expect(screen.getByText("search_code")).toBeInTheDocument();
      expect(
        screen.queryByText("previous_process_tool"),
      ).not.toBeInTheDocument();
      fireEvent.click(outcomes);
      await act(async () =>
        fireEvent.click(
          screen.getByRole("option", {
            name: language === "zh" ? "已中断" : "Interrupted",
          }),
        ),
      );
      expect(screen.getByText("previous_process_tool")).toBeInTheDocument();
      expect(screen.queryByText("search_code")).not.toBeInTheDocument();
    },
  );

  it("updates a pristine runtime draft after polling changes the saved executable", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    await mount();
    await navigate("Settings");
    snapshot.workspaces[0].coreCommand = [
      "/externally/saved/core",
      "--project",
      "/new/project",
    ];
    await tick(4000);
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/externally/saved/core",
    );
    expect(screen.getByLabelText("Arguments (one per line)")).toHaveValue(
      "--project\n/new/project",
    );
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
    expect(count("save_workspace")).toBe(0);
  });

  it("preserves a dirty runtime draft across polling and saves against the latest workspace", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    snapshot.workspaces[0].coreCommand = ["/saved/core", "--original"];
    await mount();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: "/draft/core" },
    });
    snapshot.workspaces[0].coreCommand = ["/external/core", "--external"];
    snapshot.workspaces[0].name = "Renamed workspace";
    await tick(4000);
    expect(screen.getByLabelText("Executable path")).toHaveValue("/draft/core");
    expect(screen.getByLabelText("Arguments (one per line)")).toHaveValue(
      "--original",
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save runtime selection" }),
      ),
    );
    expect(snapshot.workspaces[0].coreCommand).toEqual([
      "/draft/core",
      "--original",
    ]);
    expect(snapshot.workspaces[0].name).toBe("Renamed workspace");
  });

  it("clears preference dirty state when a change is undone, then accepts refreshed settings", async () => {
    await mount();
    await navigate("Settings");
    const toggle = screen.getByRole("switch", { name: "Close to tray" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    snapshot.settings.closeToTray = false;
    await tick(4000);
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(count("save_settings")).toBe(0);
  });

  it("applies a confirmed settings save even when the follow-up snapshot fails", async () => {
    await mount();
    await navigate("Settings");
    fireEvent.click(screen.getByRole("textbox", { name: "Language" }));
    fireEvent.click(screen.getByRole("option", { name: "简体中文" }));
    invoke.mockImplementation((command, args) =>
      command === "snapshot"
        ? Promise.reject(new Error("Temporary refresh failure"))
        : defaultInvoke(command, args),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save changes" })),
    );
    expect(
      screen.getByRole("heading", { name: "偏好设置" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();
    expect(
      screen.getByRole("alert", { name: "无法刷新状态" }),
    ).toHaveTextContent("Temporary refresh failure");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(count("save_settings")).toBe(1);
    await navigate("概览");
    await navigate("设置");
    expect(screen.getByRole("textbox", { name: "语言" })).toHaveValue(
      "简体中文",
    );
  });

  it("preserves a dirty preference draft when polling returns updated settings", async () => {
    await mount();
    await navigate("Settings");
    fireEvent.click(screen.getByRole("textbox", { name: "Language" }));
    fireEvent.click(screen.getByRole("option", { name: "简体中文" }));
    snapshot.settings.closeToTray = false;
    await tick(4000);
    expect(screen.getByRole("textbox", { name: "Language" })).toHaveValue(
      "简体中文",
    );
    expect(screen.getByRole("switch", { name: "Close to tray" })).toBeChecked();
    expect(count("save_settings")).toBe(0);
  });

  it.each(["en", "zh"] as const)(
    "names navigation, dialog close and keyboard secret controls in %s",
    async (language) => {
      snapshot = fixtureSnapshot({ stopped: true, tunnelFailure: true });
      snapshot.settings.language = language;
      const t = translator(language);
      await mount();
      const nav = screen.getByRole("navigation", {
        name: t("Main navigation"),
      });
      expect(
        within(nav).getByRole("button", { name: t("Dashboard") }),
      ).toHaveAttribute("aria-current", "page");
      await navigate(t("Connections"));
      expect(
        within(nav).getByRole("button", { name: t("Connections") }),
      ).toHaveAttribute("aria-current", "page");
      expect(
        within(nav).getByRole("button", { name: t("Dashboard") }),
      ).not.toHaveAttribute("aria-current");
      fireEvent.click(
        screen.getByRole("button", { name: t("Edit workspace") }),
      );
      const modal = screen.getByRole("dialog", { name: t("Edit workspace") });
      const reveals = within(modal).getAllByRole("button", {
        name: t("Toggle password visibility"),
      });
      expect(reveals).toHaveLength(2);
      for (const reveal of reveals) {
        expect(reveal).toHaveAttribute("tabindex", "0");
        expect(reveal).toHaveAttribute("aria-pressed", "false");
        fireEvent.keyDown(reveal, { key: " " });
        expect(reveal).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(reveal, { detail: 0 });
        expect(reveal).toHaveAttribute("aria-pressed", "false");
      }
      fireEvent.click(within(modal).getByRole("button", { name: t("Close") }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(count("save_workspace")).toBe(0);
    },
  );

  it("does not start services or call dismissed editor callbacks after a late create response", async () => {
    const save = deferred<Workspace>();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    invoke.mockImplementation((command, args) =>
      command === "save_workspace"
        ? save.promise
        : defaultInvoke(command, args),
    );
    const view = render(
      <MantineProvider env="test">
        <WorkspaceModal
          workspace={null}
          onSaved={onSaved}
          onClose={onClose}
          t={translator("en")}
        />
      </MantineProvider>,
    );
    fireEvent.change(
      screen.getByLabelText("Workspace name", { exact: false }),
      { target: { value: "New project" } },
    );
    fireEvent.change(screen.getByLabelText("Folder path", { exact: false }), {
      target: { value: "/fixture/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create and start" }));
    expect(count("save_workspace")).toBe(1);
    view.unmount();
    await act(async () =>
      save.resolve({ ...snapshot.workspaces[0], id: "created-workspace" }),
    );
    expect(count("start_workspace")).toBe(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Stop and configuration locks available when process cleanup is still pending without a live PID", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    snapshot.statuses[0].state = "error";
    snapshot.statuses[0].cleanupPending = true;
    await mount();
    expect(
      screen.getByRole("button", { name: "Stop workspace" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Start workspace" }),
    ).not.toBeInTheDocument();
    await navigate("Connections");
    expect(
      screen.getByRole("button", { name: "Edit workspace" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove workspace" }),
    ).toBeDisabled();
    await navigate("Settings");
    expect(screen.getByLabelText("Executable path")).toBeDisabled();
    await navigate("Dashboard");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Stop workspace" })),
    );
    expect(invoke).toHaveBeenCalledWith("stop_workspace", {
      id: "test-workspace",
    });
    expect(count("start_workspace")).toBe(0);
  });

  it("updates a reopened runtime editor when an earlier save finishes without changing the current page", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    const save = deferred<Workspace>();
    invoke.mockImplementation((command, args) =>
      command === "save_workspace"
        ? save.promise
        : defaultInvoke(command, args),
    );
    await mount();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: "/slow/saved/core" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save runtime selection" }),
    );
    await navigate("Dashboard");
    await navigate("Settings");
    const saved = {
      ...snapshot.workspaces[0],
      coreCommand: ["/slow/saved/core"],
    };
    snapshot.workspaces[0] = saved;
    await act(async () => save.resolve(saved));
    expect(
      screen.getByRole("heading", { name: "Preferences" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/slow/saved/core",
    );
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
    expect(count("save_workspace")).toBe(1);
  });

  it.each(["Escape", "Cancel", "Close"])(
    "returns focus to the editor trigger after repeated %s dismissal",
    async (dismissal) => {
      snapshot = fixtureSnapshot({ stopped: true });
      await mount();
      await navigate("Connections");
      const edit = screen.getByRole("button", { name: "Edit workspace" });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        edit.focus();
        fireEvent.click(edit);
        const dialog = screen.getByRole("dialog", { name: "Edit workspace" });
        const input = within(dialog).getByLabelText("Workspace name", {
          exact: false,
        });
        input.focus();
        expect(input).toHaveFocus();
        if (dismissal === "Escape") fireEvent.keyDown(input, { key: "Escape" });
        else
          fireEvent.click(
            within(dialog).getByRole("button", { name: dismissal }),
          );
        await tick(20);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(edit).toHaveFocus();
        expect(
          within(screen.getByRole("navigation")).getByRole("button", {
            name: "Connections",
          }),
        ).toHaveAttribute("aria-current", "page");
      }
      expect(count("save_workspace")).toBe(0);
    },
  );

  it.each([
    {
      page: "Connections",
      trigger: "Remove workspace",
      title: "Remove this workspace?",
    },
    {
      page: "Settings",
      trigger: "Quit application",
      title: "Quit and stop services?",
    },
    {
      page: "Connections",
      trigger: "Create tunnel and DNS",
      title: "Create tunnel and DNS",
    },
  ])(
    "returns focus when the $trigger confirmation is cancelled",
    async ({ page, trigger, title }) => {
      snapshot = fixtureSnapshot({ stopped: true, tunnelFailure: true });
      await mount();
      await navigate(page);
      const opener = screen.getByRole("button", { name: trigger });
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole("dialog", { name: title });
      within(dialog).getByRole("checkbox").focus();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await tick(20);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
      expect(count("delete_workspace")).toBe(0);
      expect(count("quit_app")).toBe(0);
      expect(count("setup_named_tunnel")).toBe(0);
    },
  );

  it("does not restore a tunnel confirmation's focus after its page is removed", async () => {
    snapshot = fixtureSnapshot({ stopped: true, tunnelFailure: true });
    await mount();
    await navigate("Connections");
    const opener = screen.getByRole("button", {
      name: "Create tunnel and DNS",
    });
    opener.focus();
    fireEvent.click(opener);
    screen.getByRole("checkbox", { name: "Create tunnel and DNS" }).focus();
    const restore = vi.spyOn(opener, "focus");
    await navigate("Dashboard");
    const dashboard = within(screen.getByRole("navigation")).getByRole(
      "button",
      { name: "Dashboard" },
    );
    dashboard.focus();
    await tick(20);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dashboard).toHaveFocus();
    expect(restore).not.toHaveBeenCalled();
  });

  it("does not pull focus back to the persistent New workspace button after successful save navigation", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    invoke.mockImplementation((command, args) => {
      if (command === "save_workspace") {
        const saved = {
          ...(args?.workspace as Workspace),
          id: "created-workspace",
        };
        snapshot.workspaces.push(saved);
        return Promise.resolve(saved);
      }
      return defaultInvoke(command, args);
    });
    await mount();
    await navigate("Connections");
    const opener = screen.getByRole("button", { name: "New workspace" });
    opener.focus();
    fireEvent.click(opener);
    const input = screen.getByLabelText("Workspace name", { exact: false });
    input.focus();
    fireEvent.change(input, { target: { value: "Created project" } });
    fireEvent.change(screen.getByLabelText("Folder path", { exact: false }), {
      target: { value: "/fixture/created" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const restore = vi.spyOn(opener, "focus");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Create workspace" })),
    );
    await tick(20);
    expect(
      screen.getByRole("heading", { name: "Created project" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "Dashboard",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(opener).toBeInTheDocument();
    expect(opener).not.toHaveFocus();
    expect(restore).not.toHaveBeenCalled();
    expect(count("save_workspace")).toBe(1);
  });

  it("preserves the current focus when polling replaces the editor's workspace and opener before dismissal", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    addSecondWorkspace();
    await mount();
    await navigate("Connections");
    const previousOpener = screen.getByRole("button", {
      name: "Edit workspace",
    });
    previousOpener.focus();
    fireEvent.click(previousOpener);
    const dialog = screen.getByRole("dialog", { name: "Edit workspace" });
    within(dialog).getByLabelText("Workspace name", { exact: false }).focus();
    snapshot.workspaces = snapshot.workspaces.slice(1);
    snapshot.statuses = snapshot.statuses.slice(1);
    await tick(4000);
    expect(previousOpener).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Birch workspace" }),
    ).toBeInTheDocument();
    const currentOpener = screen.getByRole("button", {
      name: "Edit workspace",
    });
    currentOpener.focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await tick(20);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(currentOpener).toHaveFocus();
    expect(count("save_workspace")).toBe(0);
  });

  it("preserves current focus when the editor opener becomes disabled before dismissal", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    await mount();
    await navigate("Connections");
    const opener = screen.getByRole("button", { name: "Edit workspace" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Edit workspace" });
    within(dialog).getByLabelText("Workspace name", { exact: false }).focus();
    snapshot.statuses[0].cleanupPending = true;
    await tick(4000);
    expect(opener).toBeDisabled();
    const dashboard = within(screen.getByRole("navigation")).getByRole(
      "button",
      { name: "Dashboard" },
    );
    dashboard.focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await tick(20);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dashboard).toHaveFocus();
    expect(count("save_workspace")).toBe(0);
  });
});
