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
import { fixtureSnapshot, fixtureStatus } from "./test/fixtures";
import type { Snapshot, Workspace } from "./types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let snapshot: Snapshot;
let errors: Record<string, string>;
let clipboard: ReturnType<typeof vi.fn>;
const count = (name: string) =>
  invoke.mock.calls.filter(([command]) => command === name).length;
const t = (text: string) => translator(snapshot.settings.language)(text);

async function mount() {
  await act(async () => {
    render(
      <MantineProvider env="test">
        <App />
      </MantineProvider>,
    );
  });
}
async function click(name: string, scope: HTMLElement = document.body) {
  await act(async () =>
    fireEvent.click(within(scope).getByRole("button", { name })),
  );
}
async function navigate(name: string) {
  await click(t(name), screen.getByRole("navigation"));
}
async function poll() {
  await act(async () => vi.advanceTimersByTimeAsync(4000));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  snapshot = fixtureSnapshot({ stopped: true });
  // The native manager retains the configured local endpoint while stopped.
  snapshot.statuses[0].localEndpoint = fixtureStatus.localEndpoint;
  errors = {};
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (errors[command]) throw new Error(errors[command]);
    if (command === "validate_workspace_path") return String(args?.path);
    if (command === "snapshot") return structuredClone(snapshot);
    if (command === "activity") return [];
    if (command === "install_core") {
      snapshot.coreAvailable = true;
      return "Core installed";
    }
    if (command === "save_workspace") {
      const saved = {
        ...(args?.workspace as Workspace),
        id: "created-workspace",
        port: 8765,
      };
      snapshot.workspaces = [saved];
      snapshot.statuses = [{ ...fixtureStatus, workspaceId: saved.id }];
      return saved;
    }
    if (command === "start_workspace") return fixtureStatus;
    if (command === "connection_config")
      return JSON.stringify({
        mcpServers: {
          atlas: {
            url: args?.public
              ? snapshot.statuses[0].publicEndpoint
              : snapshot.statuses[0].localEndpoint,
          },
        },
      });
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe.each(["en", "zh"] as const)("first-run guidance in %s", (language) => {
  beforeEach(() => {
    snapshot.settings.language = language;
  });

  it("uses an existing Core for the first workspace without installing another one", async () => {
    snapshot.workspaces = [];
    snapshot.statuses = [];
    snapshot.coreAvailable = false;
    await mount();
    await click(t("Create your first workspace"));
    const dialog = screen.getByRole("dialog", { name: t("New workspace") });
    await click(t("Use existing Core"), dialog);
    fireEvent.change(
      within(dialog).getByLabelText(t("Existing core executable")),
      {
        target: { value: "/fixture/core" },
      },
    );
    fireEvent.change(
      within(dialog).getByLabelText(t("Workspace name"), { exact: false }),
      {
        target: { value: "New project" },
      },
    );
    fireEvent.change(
      within(dialog).getByLabelText(t("Folder path"), { exact: false }),
      {
        target: { value: "/test-fixtures/new-project" },
      },
    );
    await click(t("Continue"), dialog);
    await click(t("Continue"), dialog);
    await click(t("Create and start"), dialog);
    expect(invoke).toHaveBeenCalledWith("validate_core_override", {
      path: "/test-fixtures/new-project",
      args: ["/fixture/core"],
    });
    expect(count("install_core")).toBe(0);
    expect(count("save_workspace")).toBe(1);
    expect(count("start_workspace")).toBe(1);
  });

  it("offers a pinned recommended version, and does not install on navigation", async () => {
    snapshot.workspaces = [];
    snapshot.statuses = [];
    snapshot.coreAvailable = false;
    await mount();
    await navigate("Settings");
    expect(count("install_core")).toBe(0);
    await click(`${t("Install recommended Core")} (0.5.0)`);
    expect(invoke).toHaveBeenCalledWith("install_core", { version: "0.5.0" });
  });

  it("stops in the folder step when the desktop rejects the path", async () => {
    snapshot.workspaces = [];
    snapshot.statuses = [];
    errors.validate_workspace_path = "Choose an existing workspace folder";
    await mount();
    await click(t("Create your first workspace"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText(t("Workspace name"), { exact: false }),
      {
        target: { value: "Project" },
      },
    );
    fireEvent.change(
      within(dialog).getByLabelText(t("Folder path"), { exact: false }),
      {
        target: { value: "/missing-project" },
      },
    );
    await click(t("Continue"), dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      t("Choose an existing workspace folder"),
    );
    const folder = within(dialog).getByLabelText(t("Folder path"), {
      exact: false,
    });
    expect(folder).toBeVisible();
    expect(folder).toHaveFocus();
    expect(folder).toHaveAttribute("aria-invalid", "true");
    expect(count("save_workspace")).toBe(0);
  });

  it("lets IME finish composing before Enter can advance the folder step", async () => {
    snapshot.workspaces = [];
    snapshot.statuses = [];
    await mount();
    await click(t("Create your first workspace"));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText(t("Workspace name"), {
      exact: false,
    });
    const folder = within(dialog).getByLabelText(t("Folder path"), {
      exact: false,
    });
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "测试项目" } });
    fireEvent.change(folder, { target: { value: "/fixture/project" } });
    await act(async () =>
      fireEvent.keyDown(name, { key: "Enter", isComposing: true }),
    );
    await act(async () =>
      fireEvent.keyDown(name, { key: "Enter", keyCode: 229 }),
    );
    expect(count("validate_workspace_path")).toBe(0);
    expect(name).toHaveValue("测试项目");
    await act(async () => fireEvent.keyDown(name, { key: "Enter" }));
    expect(count("validate_workspace_path")).toBe(1);
    expect(
      within(dialog).getByRole("textbox", { name: t("Access") }),
    ).toBeVisible();
  });

  it("shows the installation error within the wizard and can retry without losing the draft", async () => {
    snapshot.workspaces = [];
    snapshot.statuses = [];
    snapshot.coreAvailable = false;
    errors.install_core = "Runtime download interrupted";
    await mount();
    await click(t("Create your first workspace"));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText(t("Workspace name"), {
      exact: false,
    });
    fireEvent.change(name, { target: { value: "Working name" } });
    await click(t("Install core"), dialog);
    expect(
      within(dialog).getByText("Runtime download interrupted"),
    ).toBeVisible();
    expect(name).toHaveValue("Working name");
    delete errors.install_core;
    await click(t("Install core"), dialog);
    expect(count("install_core")).toBe(2);
    expect(
      within(dialog).queryByText("Runtime download interrupted"),
    ).not.toBeInTheDocument();
    expect(name).toHaveValue("Working name");
  });

  it("does not silently clamp or reinterpret an invalid port", async () => {
    await mount();
    await navigate("Connections");
    await click(t("Edit workspace"));
    const dialog = screen.getByRole("dialog");
    const port = within(dialog).getByRole("textbox", { name: t("Port") });
    for (const invalid of ["99999", "-50", "abc", "0"]) {
      fireEvent.change(port, { target: { value: invalid } });
      await click(t("Save changes"), dialog);
      expect(port).toHaveValue(invalid);
      expect(port).toHaveFocus();
      expect(port).toHaveAttribute("aria-invalid", "true");
      expect(
        within(dialog).getByText(
          t(
            "Enter a whole port number from 1 to 65535, or leave blank for automatic.",
          ),
        ),
      ).toBeVisible();
    }
    expect(count("save_workspace")).toBe(0);
  });

  it("guides a stopped default workspace to setup while allowing an explicitly selected core", async () => {
    snapshot.coreAvailable = false;
    await mount();
    expect(
      screen.queryByRole("button", { name: t("Start workspace") }),
    ).toBeNull();
    await click(
      t("Install core"),
      document.querySelector<HTMLElement>(".workspace-controls")!,
    );
    expect(count("start_workspace")).toBe(0);
    expect(invoke).toHaveBeenCalledWith("install_core", { version: "0.5.0" });
    snapshot.coreAvailable = false;
    snapshot.workspaces[0].coreCommand = ["/test-fixtures/official-core"];
    await poll();
    await navigate("Dashboard");
    await click(t("Start workspace"));
    expect(count("start_workspace")).toBe(1);
  });

  it("blocks create-and-start if Core disappears while the wizard is open", async () => {
    snapshot.workspaces = [];
    snapshot.statuses = [];
    await mount();
    await click(t("Create your first workspace"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText(t("Workspace name"), { exact: false }),
      { target: { value: "Draft" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(t("Folder path"), { exact: false }),
      { target: { value: "/test-fixtures/draft" } },
    );
    await click(t("Continue"), dialog);
    await click(t("Continue"), dialog);
    snapshot.coreAvailable = false;
    await poll();
    expect(
      within(dialog).getByRole("button", { name: t("Create and start") }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: t("Install core") }),
    ).toBeVisible();
    expect(count("save_workspace")).toBe(0);
    expect(count("start_workspace")).toBe(0);
    await click(t("Install core"), dialog);
    expect(count("install_core")).toBe(1);
    expect(count("save_workspace")).toBe(0);
    expect(count("start_workspace")).toBe(0);
    const resumed = screen.getByRole("dialog");
    expect(
      within(resumed).getByRole("button", { name: t("Create and start") }),
    ).toBeEnabled();
    await click(t("Back"), resumed);
    await click(t("Back"), resumed);
    expect(
      within(resumed).getByLabelText(t("Workspace name"), { exact: false }),
    ).toHaveValue("Draft");
    expect(
      within(resumed).getByLabelText(t("Folder path"), { exact: false }),
    ).toHaveValue("/test-fixtures/draft");
  });

  it("does not restart or stop a running workspace when its default Core disappears", async () => {
    snapshot = fixtureSnapshot();
    snapshot.settings.language = language;
    snapshot.coreAvailable = false;
    await mount();
    expect(
      screen.getByRole("button", { name: t("Stop workspace") }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: t("Restart") })).toBeNull();
    await click(
      t("Install core"),
      document.querySelector<HTMLElement>(".workspace-controls")!,
    );
    expect(count("restart_workspace")).toBe(0);
    expect(count("stop_workspace")).toBe(0);
  });

  it("rejects incomplete versions locally, clears validation on edit, and accepts a published prerelease", async () => {
    await mount();
    await navigate("Settings");
    const input = screen.getByLabelText(t("Version to install"));
    expect(input).toHaveAttribute("placeholder", t("For example, 0.5.0"));
    fireEvent.change(input, { target: { value: "0.5" } });
    await click(t("Install version"));
    expect(
      screen.getByText(t("Enter an exact version, for example 0.5.0.")),
    ).toBeVisible();
    expect(count("install_core")).toBe(0);
    fireEvent.change(input, { target: { value: "0.5.0rc1" } });
    expect(
      screen.queryByText(t("Enter an exact version, for example 0.5.0.")),
    ).toBeNull();
    await click(t("Install version"));
    expect(invoke).toHaveBeenCalledWith("install_core", {
      version: "0.5.0rc1",
    });
  });

  it("warns about an offline local endpoint when copying directly or from the configuration dialog", async () => {
    await mount();
    await navigate("Connections");
    const warning = t(
      "Local service is offline. You can copy this configuration, but start the workspace before connecting a client.",
    );
    expect(screen.getByText(warning)).toBeVisible();
    await click(
      t("Copy config"),
      document.querySelectorAll<HTMLElement>(".connection-endpoint")[0],
    );
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("region", { name: t("Operation feedback") }),
    ).toHaveTextContent(warning);
    expect(count("start_workspace")).toBe(0);
    await click(
      t("View configuration"),
      document.querySelectorAll<HTMLElement>(".connection-endpoint")[0],
    );
    const dialog = screen.getByRole("dialog", {
      name: t("Configure your client"),
    });
    expect(within(dialog).getByText(warning)).toBeVisible();
    await click(t("Copy config"), dialog);
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("region", { name: t("Operation feedback") }),
    ).toHaveTextContent(warning);
    expect(count("save_workspace")).toBe(0);
  });

  it("warns about public readiness independently of a healthy local endpoint", async () => {
    snapshot = fixtureSnapshot({ tunnelFailure: true });
    snapshot.settings.language = language;
    snapshot.statuses[0].publicEndpoint = "https://mcp.example.test/mcp";
    await mount();
    await navigate("Connections");
    const [local, remote] = document.querySelectorAll<HTMLElement>(
      ".connection-endpoint",
    );
    expect(
      within(local).queryByText(
        t(
          "Local service is offline. You can copy this configuration, but start the workspace before connecting a client.",
        ),
      ),
    ).toBeNull();
    await click(t("Copy config"), remote);
    expect(
      screen.getByRole("region", { name: t("Operation feedback") }),
    ).toHaveTextContent(
      t(
        "Public access is not verified. You can copy this configuration, but check the connection before using it.",
      ),
    );
    await click(t("Copy config"), local);
    expect(
      screen.getByRole("region", { name: t("Operation feedback") }),
    ).not.toHaveTextContent(
      t(
        "Public access is not verified. You can copy this configuration, but check the connection before using it.",
      ),
    );
  });
});

it.each([
  [
    "uv was not found in PATH or standard user/Homebrew locations. Install uv from https://docs.astral.sh/uv/getting-started/installation/ before installing a managed core",
    "未找到 uv",
  ],
  [
    "Installation failed; previous core remains selected. See core-install.log.",
    "安装失败",
  ],
  [
    "Installation timed out; previous core remains selected. See core-install.log.",
    "安装超时",
  ],
])(
  "localizes the installation failure in Chinese: %s",
  async (error, expected) => {
    snapshot.settings.language = "zh";
    errors.install_core = error;
    await mount();
    await navigate("Settings");
    fireEvent.change(screen.getByLabelText("要安装的版本"), {
      target: { value: "0.5.0" },
    });
    await click("安装版本");
    const feedback = screen.getByRole("region", { name: "操作反馈" });
    expect(feedback).toHaveTextContent(expected);
    expect(feedback).not.toHaveTextContent(error);
  },
);

it("localizes a startup summary while retaining OS and runtime diagnostic details", async () => {
  snapshot.settings.language = "zh";
  const summary =
    "Port is already in use or availability could not be confirmed. Stop its owner or choose another port; no unrelated process was terminated.";
  snapshot.statuses[0].localMessage = `${summary}: Address already in use (os error 98)\nRecent runtime output:\ndiagnostic output`;
  errors.start_workspace = snapshot.statuses[0].localMessage;
  await mount();
  await click("启动工作区");
  const feedback = screen.getByRole("region", { name: "操作反馈" });
  expect(feedback).toHaveTextContent("端口已被占用或无法确认可用");
  expect(feedback).toHaveTextContent("最近的运行输出：");
  expect(feedback).toHaveTextContent("Address already in use (os error 98)");
  expect(feedback).toHaveTextContent("diagnostic output");
  expect(feedback).not.toHaveTextContent(summary);
});
