import { MantineProvider } from "@mantine/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureCalls, fixtureSnapshot, fixtureStatus } from "./test/fixtures";
import type { Settings, Snapshot, Workspace } from "./types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let snapshot: Snapshot;
let errors: Record<string, string>;
let clipboard: ReturnType<typeof vi.fn>;
let logsCursor = 0;
const count = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).length;
function desktop() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}
function mount() {
  return render(
    <MantineProvider env="test" forceColorScheme="light">
      <App />
    </MantineProvider>,
  );
}
async function dashboard() {
  mount();
  await screen.findByRole("heading", { name: "Atlas workspace" });
}
async function navigate(name: string) {
  await userEvent.click(
    within(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).getByRole("button", { name }),
  );
}
async function onboarding() {
  snapshot = fixtureSnapshot({ empty: true });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Create your first workspace" }),
  );
  await userEvent.type(screen.getByLabelText(/Workspace name/), "New project");
  await userEvent.type(
    screen.getByLabelText(/Folder path/),
    "/test-fixtures/new-project",
  );
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
}
async function review() {
  await onboarding();
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
}
beforeEach(() => {
  desktop();
  snapshot = fixtureSnapshot();
  errors = {};
  logsCursor = 0;
  invoke.mockReset();
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  invoke.mockImplementation(
    async (command: string, args?: Record<string, unknown>) => {
      if (errors[command]) throw new Error(errors[command]);
      if (command === "snapshot") return structuredClone(snapshot);
      if (command === "activity") return structuredClone(fixtureCalls);
      if (command === "pick_directory") return "/test-fixtures/picked-project";
      if (command === "save_workspace") {
        const next = {
          ...(args?.workspace as Workspace),
          id: (args?.workspace as Workspace).id || "created-workspace",
          port: (args?.workspace as Workspace).port || 8766,
        };
        snapshot.workspaces = [
          ...snapshot.workspaces.filter((w) => w.id !== next.id),
          next,
        ];
        snapshot.statuses = [
          ...snapshot.statuses.filter((s) => s.workspaceId !== next.id),
          {
            ...fixtureStatus,
            workspaceId: next.id,
            state: "stopped",
            pid: null,
            localState: "offline",
            localEndpoint: "",
          },
        ];
        return next;
      }
      if (command === "start_workspace" || command === "stop_workspace") {
        const status = {
          ...fixtureStatus,
          workspaceId: String(args?.id),
          ...(command === "stop_workspace"
            ? {
                state: "stopped" as const,
                pid: null,
                localState: "offline",
                localEndpoint: "",
              }
            : {}),
        };
        snapshot.statuses = [
          ...snapshot.statuses.filter((s) => s.workspaceId !== args?.id),
          status,
        ];
        return status;
      }
      if (command === "save_settings") {
        snapshot.settings = args?.settings as Settings;
        return snapshot.settings;
      }
      if (command === "connection_config")
        return '{"mcpServers":{"atlas":{"url":"http://127.0.0.1:8765/mcp"}}}';
      if (command === "diagnose")
        return [
          {
            level: "ok",
            name: "Local endpoint",
            message: "Test fixture: local endpoint verified",
          },
          {
            level: "error",
            name: "Public endpoint",
            message: "Test fixture: public endpoint unavailable",
          },
        ];
      if (command === "logs") {
        logsCursor += 1;
        return {
          text: `${args?.kind} fixture line ${logsCursor}\n`,
          cursor: logsCursor,
          truncated: false,
        };
      }
      if (command === "delete_workspace") {
        snapshot.workspaces = [];
        snapshot.statuses = [];
        return null;
      }
      return null;
    },
  );
});

describe("desktop rendered flows through mocked Tauri invoke", () => {
  it("browser preview discloses unavailable backend and never invents data or invokes IPC", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser preview only. No services are running here.",
    );
    expect(screen.queryByText("Atlas workspace")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Create your first workspace" }),
    );
    expect(screen.getByRole("button", { name: "Browse" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Workspace name/), "Preview");
    await userEvent.type(screen.getByLabelText(/Folder path/), "/preview");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("button", { name: "Create and start" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create workspace" }),
    ).toBeDisabled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("local-first onboarding preserves folder fields through Back and cancel performs no save", async () => {
    await onboarding();
    expect(screen.getByRole("textbox", { name: "Access" })).toHaveValue(
      "Only this device",
    );
    expect(screen.getByRole("radio", { name: "Safe" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText(/Workspace name/)).toHaveValue("New project");
    expect(screen.getByLabelText(/Folder path/)).toHaveValue(
      "/test-fixtures/new-project",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(count("save_workspace")).toBe(0);
  });
  it("requires folder and name before leaving onboarding first step", async () => {
    snapshot = fixtureSnapshot({ empty: true });
    mount();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Create your first workspace",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Name and folder are required.",
    );
    expect(count("save_workspace")).toBe(0);
  });
  it("creates and starts once despite repeated submit with safe local defaults", async () => {
    await review();
    let resolveSave!: (value: Workspace) => void;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) =>
      command === "save_workspace"
        ? new Promise<Workspace>((resolve) => {
            resolveSave = resolve;
          })
        : original(command, args),
    );
    const button = screen.getByRole("button", { name: "Create and start" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(count("save_workspace")).toBe(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const submitted = invoke.mock.calls.find(
      ([name]) => name === "save_workspace",
    )?.[1].workspace as Workspace;
    expect(submitted).toMatchObject({
      name: "New project",
      path: "/test-fixtures/new-project",
      access: "local",
      auth: "noauth",
      permissionMode: "safe",
      port: 0,
    });
    snapshot.workspaces = [
      { ...submitted, id: "created-workspace", port: 8766 },
    ];
    await act(async () => resolveSave(snapshot.workspaces[0]));
    await waitFor(() => expect(count("start_workspace")).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("keeps creation draft after save failure and supports retry", async () => {
    await review();
    errors.save_workspace = "Test fixture: folder permission denied";
    await userEvent.click(
      screen.getByRole("button", { name: "Create workspace" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "folder permission denied",
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText(/Workspace name/)).toHaveValue("New project");
    expect(screen.getByLabelText(/Folder path/)).toHaveValue(
      "/test-fixtures/new-project",
    );
    delete errors.save_workspace;
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Create workspace" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(count("save_workspace")).toBe(2);
    expect(count("start_workspace")).toBe(0);
  });
  it("reports saved workspace after start failure without allowing duplicate creation", async () => {
    await review();
    errors.start_workspace = "Test fixture: runtime missing";
    await userEvent.click(
      screen.getByRole("button", { name: "Create and start" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Created successfully. Start failed; your workspace is saved and can be retried.",
    );
    expect(
      screen.queryByRole("button", { name: "Create and start" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByRole("heading", { name: "New project" }),
    ).toBeInTheDocument();
    expect(count("save_workspace")).toBe(1);
  });
  it("disables configuration and deletion while running and allows editing after stopping", async () => {
    await dashboard();
    await navigate("Connections");
    expect(
      screen.getByRole("button", { name: "Edit workspace" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove workspace" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Stop workspace" }),
    );
    expect(count("stop_workspace")).toBe(1);
    expect(snapshot.statuses[0].state).toBe("stopped");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit workspace" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit workspace" }),
    );
    expect(screen.getByLabelText(/Workspace name/)).toHaveValue(
      "Atlas workspace",
    );
  });
  it("copy configuration is read-only and reports clipboard failure", async () => {
    await dashboard();
    await navigate("Connections");
    clipboard.mockRejectedValueOnce(
      new Error("Test fixture: clipboard denied"),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Copy config" })[0],
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Copy failed: Test fixture: clipboard denied",
    );
    expect(invoke).toHaveBeenCalledWith("connection_config", {
      id: "test-workspace",
      public: false,
    });
    expect(count("save_workspace")).toBe(0);
    await userEvent.click(
      screen.getAllByRole("button", { name: "Copy config" })[0],
    );
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    expect(count("save_workspace")).toBe(0);
  });
  it("shows public tunnel failure while retaining verified local online service", async () => {
    snapshot = fixtureSnapshot({ tunnelFailure: true });
    await dashboard();
    expect(screen.getByText("Online", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8765/mcp")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Test fixture: Cloudflare tunnel authentication failed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Local service remains available. Fix the tunnel without restarting your tools.",
      ),
    ).toBeInTheDocument();
    await navigate("Connections");
    expect(screen.getByRole("button", { name: "Retry tunnel" })).toBeEnabled();
    expect(screen.getByLabelText("Tunnel name")).toBeDisabled();
    expect(screen.getByLabelText("Hostname")).toBeDisabled();
    expect(count("stop_workspace")).toBe(0);
  });
  it("searches real activity payloads and filters failed versus pending calls", async () => {
    await dashboard();
    await screen.findByText("execute_command");
    await navigate("Activity");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search tools" }),
      "EXECUTE",
    );
    expect(screen.getByText("execute_command")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
    await userEvent.clear(
      screen.getByRole("textbox", { name: "Search tools" }),
    );
    await userEvent.click(
      screen.getByRole("textbox", { name: "All outcomes" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Failed" }));
    expect(screen.getByText("execute_command")).toBeInTheDocument();
    expect(screen.queryByText("search_code")).not.toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search tools" }),
      "no-such-tool",
    );
    expect(screen.getByText("No matching calls")).toBeInTheDocument();
  });
  it("shows activity errors rather than manufactured successful calls", async () => {
    errors.activity = "Test fixture: activity database unavailable";
    await dashboard();
    expect(
      await screen.findByText("Test fixture: activity database unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });
  it("persists language only after save and rerenders translated interface", async () => {
    await dashboard();
    await navigate("Settings");
    await userEvent.click(screen.getByRole("textbox", { name: "Language" }));
    await userEvent.click(screen.getByRole("option", { name: "简体中文" }));
    expect(count("save_settings")).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "偏好设置" });
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(invoke).toHaveBeenCalledWith("save_settings", {
      settings: { language: "zh", closeToTray: true },
    });
  });
  it("keeps unsaved settings after failed save", async () => {
    await dashboard();
    await navigate("Settings");
    await userEvent.click(screen.getByRole("textbox", { name: "Language" }));
    await userEvent.click(screen.getByRole("option", { name: "简体中文" }));
    errors.save_settings = "Test fixture: settings write failed";
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Test fixture: settings write failed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Language" })).toHaveValue(
      "简体中文",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });
  it("runs diagnostics and reads incremental logs with correct cursor reset on tab switch", async () => {
    await dashboard();
    await navigate("Diagnostics");
    await screen.findByText("runtime fixture line 1");
    await userEvent.click(screen.getByRole("button", { name: "Run checks" }));
    expect(
      await screen.findByText("Test fixture: local endpoint verified"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Test fixture: public endpoint unavailable"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh logs" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("logs", {
        id: "test-workspace",
        kind: "runtime",
        cursor: 1,
      }),
    );
    await userEvent.click(screen.getByRole("radio", { name: "Tunnel logs" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("logs", {
        id: "test-workspace",
        kind: "tunnel",
        cursor: 0,
      }),
    );
    expect(
      await screen.findByText("tunnel fixture line 3"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/runtime fixture line/)).not.toBeInTheDocument();
  });
  it("shows load failure and retries without inventing a workspace", async () => {
    errors.snapshot = "Test fixture: backend cannot read config";
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load workspaces",
    );
    expect(screen.queryByText("Atlas workspace")).not.toBeInTheDocument();
    delete errors.snapshot;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("heading", { name: "Atlas workspace" }),
    ).toBeInTheDocument();
  });
  it("requires explicit confirmation for workspace removal and cancel is inert", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    await dashboard();
    await navigate("Connections");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove workspace" }),
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(count("delete_workspace")).toBe(0);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove workspace" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Remove this workspace?" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByRole("button", { name: "Create your first workspace" });
    expect(count("delete_workspace")).toBe(1);
  });
  it("discloses unavailable tool history without fabricating calls", async () => {
    snapshot.statuses[0].activityState = "unavailable";
    snapshot.statuses[0].activityMessage =
      "Test fixture: installed core lacks activity events";
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) =>
      command === "activity" ? Promise.resolve([]) : original(command, args),
    );
    await dashboard();
    await navigate("Activity");
    expect(
      screen.getByRole("heading", { name: "Tool history unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Test fixture: installed core lacks activity events"),
    ).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
    expect(screen.getByText(/No calls are fabricated/)).toBeInTheDocument();
  });
  it("preserves literal executable arguments without shell splitting", async () => {
    snapshot = fixtureSnapshot({ stopped: true });
    await dashboard();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: "/test fixtures/venv/bin/coding-tools-mcp" },
    });
    fireEvent.change(screen.getByLabelText("Arguments (one per line)"), {
      target: {
        value:
          '--project\n/path with spaces\n$HOME; echo harmless\n"quoted literal"',
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Save runtime selection" }),
    );
    await waitFor(() => expect(count("save_workspace")).toBe(1));
    expect(
      invoke.mock.calls.find(([name]) => name === "save_workspace")?.[1]
        .workspace.coreCommand,
    ).toEqual([
      "/test fixtures/venv/bin/coding-tools-mcp",
      "--project",
      "/path with spaces",
      "$HOME; echo harmless",
      '"quoted literal"',
    ]);
  });
  it("blocks runtime overrides while a failed stop leaves a live process", async () => {
    snapshot.statuses[0].state = "error";
    snapshot.statuses[0].pid = 4242;
    await dashboard();
    await navigate("Settings");
    expect(screen.getByLabelText("Executable path")).toBeDisabled();
    expect(screen.getByLabelText("Arguments (one per line)")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
    expect(count("save_workspace")).toBe(0);
  });
});
