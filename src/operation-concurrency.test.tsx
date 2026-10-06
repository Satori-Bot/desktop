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
import { translator } from "./i18n";
import { fixtureSnapshot } from "./test/fixtures";
import type { Snapshot, Status, Workspace } from "./types";

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
const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command);
async function fallback(command: string, args?: Record<string, unknown>) {
  if (command === "snapshot") return structuredClone(snapshot);
  if (command === "activity") return [];
  if (command === "save_workspace") {
    const saved = structuredClone(args?.workspace as Workspace);
    snapshot.workspaces = snapshot.workspaces.map((workspace) =>
      workspace.id === saved.id ? saved : workspace,
    );
    return saved;
  }
  if (command === "stop_workspace") {
    const status = snapshot.statuses.find(
      (item) => item.workspaceId === args?.id,
    )!;
    Object.assign(status, {
      state: "stopped",
      pid: null,
      localState: "offline",
      localEndpoint: "",
      portReleasePending: false,
      cleanupPending: false,
    });
    return structuredClone(status);
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
async function selectWorkspace(name: string, label = "Choose workspace") {
  const selector = screen.getByRole("textbox", { name: label });
  expect(selector).toBeEnabled();
  fireEvent.click(selector);
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name }));
  });
  expect(selector).toHaveValue(name);
}
async function saveRuntime(executable: string) {
  fireEvent.change(screen.getByLabelText("Executable path"), {
    target: { value: executable },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Save runtime selection" }),
    );
  });
}
function addSecondWorkspace() {
  snapshot.workspaces.push({
    ...snapshot.workspaces[0],
    id: "birch-workspace",
    name: "Birch workspace",
    path: "/test-fixtures/birch",
    port: 8766,
    coreCommand: ["/official/birch-core"],
  });
  snapshot.statuses.push({
    ...snapshot.statuses[0],
    workspaceId: "birch-workspace",
    localEndpoint: "http://127.0.0.1:8766/mcp",
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  snapshot = fixtureSnapshot({ stopped: true });
  snapshot.workspaces[0].coreCommand = ["/official/old-core"];
  invoke.mockReset();
  invoke.mockImplementation(fallback);
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("authoritative runtime saves", () => {
  it("retains a save across unmount/reopen and refresh failure, including a later arguments-only save", async () => {
    const save = deferred<Workspace>();
    invoke.mockImplementation((command, args) =>
      command === "save_workspace" ? save.promise : fallback(command, args),
    );
    await mount();
    await navigate("Settings");
    await saveRuntime("/official/new-core");
    await navigate("Dashboard");
    await navigate("Settings");
    const saved = {
      ...snapshot.workspaces[0],
      coreCommand: ["/official/new-core"],
    };
    snapshot.workspaces[0] = saved;
    invoke.mockImplementation((command, args) =>
      command === "snapshot"
        ? Promise.reject(new Error("Temporary snapshot failure"))
        : fallback(command, args),
    );
    await act(async () => save.resolve(saved));
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/official/new-core",
    );
    expect(
      screen.getByRole("alert", { name: "Unable to refresh status" }),
    ).toHaveTextContent("Temporary snapshot failure");
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Arguments (one per line)"), {
      target: { value: "--example" },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save runtime selection" }),
      ),
    );
    expect(snapshot.workspaces[0].coreCommand).toEqual([
      "/official/new-core",
      "--example",
    ]);
    expect(calls("save_workspace")).toHaveLength(2);
  });

  it("commits the persisted workspace before a slow refresh and rejects a late pre-save snapshot", async () => {
    const oldSnapshot = structuredClone(snapshot);
    const oldPoll = deferred<Snapshot>();
    const refresh = deferred<Snapshot>();
    let reads = 0;
    invoke.mockImplementation((command, args) => {
      if (command === "snapshot") {
        reads += 1;
        if (reads === 2) return oldPoll.promise;
        if (reads === 3) return refresh.promise;
      }
      return fallback(command, args);
    });
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    await navigate("Settings");
    await saveRuntime(" /official/new-core ");
    await navigate("Dashboard");
    await navigate("Settings");
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/official/new-core",
    );
    expect(screen.getByLabelText("Executable path")).toBeDisabled();
    await act(async () => refresh.resolve(structuredClone(snapshot)));
    await act(async () => oldPoll.resolve(oldSnapshot));
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/official/new-core",
    );
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
  });

  it("keys out-of-order workspace saves without changing selection or replacing a newer draft", async () => {
    addSecondWorkspace();
    const atlasSave = deferred<Workspace>();
    invoke.mockImplementation((command, args) =>
      command === "save_workspace" &&
      (args?.workspace as Workspace).id === "test-workspace"
        ? atlasSave.promise
        : fallback(command, args),
    );
    await mount();
    await navigate("Settings");
    await saveRuntime("/official/atlas-new");
    await selectWorkspace("Birch workspace");
    expect(screen.getByLabelText("Executable path")).toBeEnabled();
    invoke.mockImplementation((command, args) =>
      command === "snapshot"
        ? Promise.reject(new Error("Temporary snapshot failure"))
        : fallback(command, args),
    );
    await saveRuntime("/official/birch-new");
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: "/birch/unsaved-draft" },
    });
    const saved = {
      ...snapshot.workspaces[0],
      coreCommand: ["/official/atlas-new"],
    };
    snapshot.workspaces[0] = saved;
    await act(async () => atlasSave.resolve(saved));
    expect(
      screen.getByRole("textbox", { name: "Choose workspace" }),
    ).toHaveValue("Birch workspace");
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/birch/unsaved-draft",
    );
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeEnabled();
    await selectWorkspace("Atlas workspace");
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/official/atlas-new",
    );
    await selectWorkspace("Birch workspace");
    expect(screen.getByLabelText("Executable path")).toHaveValue(
      "/official/birch-new",
    );
    expect(calls("save_workspace")).toHaveLength(2);
  });
});

describe("independent workspace controls during maintenance", () => {
  it.each(["en", "zh"] as const)(
    "keeps switching and Stop available in %s while serializing each workspace and maintenance",
    async (language) => {
      snapshot = fixtureSnapshot();
      snapshot.settings.language = language;
      addSecondWorkspace();
      const t = translator(language);
      const install = deferred<string>();
      const birchStop = deferred<Status>();
      invoke.mockImplementation((command, args) => {
        if (command === "install_core") return install.promise;
        if (command === "stop_workspace" && args?.id === "birch-workspace")
          return birchStop.promise;
        return fallback(command, args);
      });
      await mount();
      await navigate(t("Settings"));
      fireEvent.change(screen.getByLabelText(t("Version to install")), {
        target: { value: "0.5.0" },
      });
      await act(async () => {
        const button = screen.getByRole("button", {
          name: t("Install version"),
        });
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(calls("install_core")).toHaveLength(1);
      await navigate(t("Dashboard"));
      await selectWorkspace("Birch workspace", t("Choose workspace"));
      expect(
        screen.getByRole("status", { name: t("Background operation") }),
      ).toHaveTextContent(t("Installing core…"));
      const stop = screen.getByRole("button", { name: t("Stop workspace") });
      expect(stop).toBeEnabled();
      await act(async () => {
        fireEvent.click(stop);
        fireEvent.click(stop);
      });
      expect(calls("stop_workspace")).toEqual([
        ["stop_workspace", { id: "birch-workspace" }],
      ]);
      expect(screen.getByRole("button", { name: t("Restart") })).toBeDisabled();
      await selectWorkspace("Atlas workspace", t("Choose workspace"));
      expect(
        screen.getByRole("button", { name: t("Stop workspace") }),
      ).toBeEnabled();
      await act(async () =>
        fireEvent.click(
          screen.getByRole("button", { name: t("Stop workspace") }),
        ),
      );
      expect(calls("stop_workspace")).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: t("Start workspace") }),
      ).toBeEnabled();
      await navigate(t("Settings"));
      expect(
        screen.getByRole("button", { name: t("Roll back") }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: t("Quit application") }),
      ).toBeDisabled();
      expect(screen.getByLabelText(t("Executable path"))).toBeEnabled();
      expect(
        screen.getByRole("textbox", { name: t("Language") }),
      ).toBeEnabled();
      await act(async () => install.resolve("Core installed"));
      // Finishing the install must not unlock a different workspace's pending Stop.
      await selectWorkspace("Birch workspace", t("Choose workspace"));
      await navigate(t("Dashboard"));
      expect(screen.getByRole("button", { name: t("Restart") })).toBeDisabled();
      await act(async () =>
        birchStop.resolve(
          (await fallback("stop_workspace", {
            id: "birch-workspace",
          })) as Status,
        ),
      );
      expect(
        screen.getByRole("button", { name: t("Start workspace") }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("status", { name: t("Background operation") }),
      ).toBeNull();
    },
  );

  it("does not let an older install completion replace newer failure feedback", async () => {
    snapshot = fixtureSnapshot();
    const install = deferred<string>();
    invoke.mockImplementation((command, args) => {
      if (command === "install_core") return install.promise;
      if (command === "stop_workspace")
        return Promise.reject(new Error("Stop needs a retry"));
      return fallback(command, args);
    });
    await mount();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("Version to install"), {
      target: { value: "0.5.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Install version" }));
    await navigate("Dashboard");
    expect(
      screen.getByRole("button", { name: "Stop workspace" }),
    ).toBeEnabled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Stop workspace" })),
    );
    const feedback = screen.getByRole("region", { name: "Operation feedback" });
    expect(feedback).toHaveTextContent("Stop needs a retry");
    await act(async () => install.resolve("Core installed"));
    expect(feedback).toHaveTextContent("Stop needs a retry");
    expect(
      screen.getByRole("button", { name: "Stop workspace" }),
    ).toBeEnabled();
  });
});

describe("concurrent failure feedback", () => {
  it.each([
    { installFirst: true, stopFails: false },
    { installFirst: true, stopFails: true },
    { installFirst: false, stopFails: false },
    { installFirst: false, stopFails: true },
  ])(
    "keeps an installation failure visible (installFirst=$installFirst, stopFails=$stopFails)",
    async ({ installFirst, stopFails }) => {
      snapshot = fixtureSnapshot();
      const install = deferred<string>();
      const stop = deferred<Status>();
      invoke.mockImplementation((command, args) => {
        if (command === "install_core") return install.promise;
        if (command === "stop_workspace") return stop.promise;
        return fallback(command, args);
      });
      await mount();
      await navigate("Settings");
      fireEvent.change(screen.getByLabelText("Version to install"), {
        target: { value: "0.5.0" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Install version" }));
      await navigate("Dashboard");
      fireEvent.click(screen.getByRole("button", { name: "Stop workspace" }));
      const finishInstall = () =>
        act(async () =>
          install.reject(new Error("Installation needs a retry")),
        );
      const finishStop = () =>
        act(async () => {
          if (stopFails) stop.reject(new Error("Stop needs a retry"));
          else
            stop.resolve(
              (await fallback("stop_workspace", {
                id: "test-workspace",
              })) as Status,
            );
        });
      if (installFirst) {
        await finishInstall();
        await finishStop();
      } else {
        await finishStop();
        await finishInstall();
      }
      const feedback = screen.getByRole("region", {
        name: "Operation feedback",
      });
      expect(feedback).toHaveTextContent(
        "Install version: Installation needs a retry",
      );
      if (stopFails) expect(feedback).toHaveTextContent("Stop needs a retry");
      expect(
        screen.queryByRole("status", { name: "Background operation" }),
      ).toBeNull();
    },
  );
});

describe("port-only release recovery", () => {
  it.each(["en", "zh"] as const)(
    "keeps Stop retry and configuration recovery available in %s without weakening owned cleanup locks",
    async (language) => {
      const t = translator(language);
      snapshot.settings.language = language;
      Object.assign(snapshot.statuses[0], {
        state: "error",
        pid: null,
        cleanupPending: false,
        portReleasePending: true,
      });
      await mount();
      expect(
        screen.getByRole("button", { name: t("Stop workspace") }),
      ).toBeEnabled();
      expect(screen.getByText(t("Port is still unavailable"))).toBeVisible();
      expect(screen.getByRole("button", { name: t("Restart") })).toBeDisabled();
      await navigate(t("Connections"));
      expect(
        screen.getByRole("button", { name: t("Edit workspace") }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: t("Remove workspace") }),
      ).toBeEnabled();
      fireEvent.click(
        screen.getByRole("button", { name: t("Remove workspace") }),
      );
      expect(
        screen.getByRole("dialog", { name: t("Remove this workspace?") }),
      ).toBeVisible();
      expect(calls("delete_workspace")).toHaveLength(0);
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: t("Cancel") })),
      );
      await navigate(t("Settings"));
      expect(screen.getByLabelText(t("Executable path"))).toBeEnabled();
      await navigate(t("Dashboard"));
      await act(async () =>
        fireEvent.click(
          screen.getByRole("button", { name: t("Stop workspace") }),
        ),
      );
      expect(calls("stop_workspace")).toEqual([
        ["stop_workspace", { id: "test-workspace" }],
      ]);
      expect(
        screen.getByRole("button", { name: t("Start workspace") }),
      ).toBeEnabled();
    },
  );
});
