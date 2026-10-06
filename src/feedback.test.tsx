/// <reference types="node" />
import { readFileSync } from "node:fs";
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
import { fixtureSnapshot } from "./test/fixtures";
import type { Snapshot, Workspace } from "./types";

const stylesheet = readFileSync("src/styles.css", "utf8");
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let snapshot: Snapshot;
let style: HTMLStyleElement;
let clipboard: ReturnType<typeof vi.fn>;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function defaultInvoke(command: string, args?: Record<string, unknown>) {
  if (command === "snapshot") return structuredClone(snapshot);
  if (command === "activity") return [];
  if (command === "save_workspace") {
    const saved = structuredClone(args?.workspace as Workspace);
    snapshot.workspaces = [saved];
    return saved;
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

async function openSettings(name = "Settings") {
  await act(async () => {
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name }),
    );
  });
  // jsdom has no layout engine. This models a retained document scroll offset;
  // the browser regression separately verifies real viewport bounding boxes.
  document.documentElement.scrollTop = 1100;
  fireEvent.scroll(document);
}

async function saveRuntime(path: string) {
  fireEvent.change(screen.getByLabelText("Executable path"), {
    target: { value: path },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Save runtime selection" }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  snapshot = fixtureSnapshot({ stopped: true });
  invoke.mockReset();
  invoke.mockImplementation(defaultInvoke);
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.append(style);
});

afterEach(() => {
  cleanup();
  style.remove();
  document.documentElement.scrollTop = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("viewport-anchored operation feedback", () => {
  it.each([
    {
      language: "en" as const,
      settings: "Settings",
      executable: "Executable path",
      save: "Save runtime selection",
      region: "Operation feedback",
      saved: "Saved",
      dismiss: "Dismiss notification",
    },
    {
      language: "zh" as const,
      settings: "设置",
      executable: "可执行文件路径",
      save: "保存核心选择",
      region: "操作反馈",
      saved: "已保存",
      dismiss: "关闭通知",
    },
  ])(
    "anchors a dismissible $language success outside scrolled Settings content",
    async ({
      language,
      settings,
      executable,
      save,
      region,
      saved,
      dismiss,
    }) => {
      snapshot.settings.language = language;
      await mount();
      await openSettings(settings);
      fireEvent.change(screen.getByLabelText(executable), {
        target: { value: "/test-fixtures/core" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: save }));
      });
      const feedback = screen.getByRole("region", { name: region });
      const alert = within(feedback).getByRole("status");
      expect(alert).toHaveTextContent(saved);
      expect(feedback.closest("main")).toBeNull();
      expect(getComputedStyle(feedback).position).toBe("fixed");
      expect(getComputedStyle(feedback).pointerEvents).toBe("none");
      expect(getComputedStyle(alert).pointerEvents).toBe("auto");
      expect(Number(getComputedStyle(feedback).zIndex)).toBeLessThan(200);
      expect(document.documentElement.scrollTop).toBe(1100);
      fireEvent.click(within(feedback).getByRole("button", { name: dismiss }));
      expect(screen.queryByRole("region", { name: region })).toBeNull();
    },
  );

  it("clears the previous outcome on save start, retains a scrolled error, and clears it on retry", async () => {
    await mount();
    await openSettings();
    await saveRuntime("/test-fixtures/core-one");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    let pending = deferred();
    invoke.mockImplementation(async (command, args) => {
      if (command === "save_workspace") await pending.promise;
      return defaultInvoke(command, args);
    });
    await saveRuntime("/test-fixtures/core-two");
    expect(
      screen.queryByRole("region", { name: "Operation feedback" }),
    ).toBeNull();
    await act(async () =>
      pending.reject(new Error("Fixture runtime save denied")),
    );
    const feedback = screen.getByRole("region", { name: "Operation feedback" });
    expect(within(feedback).getByRole("alert")).toHaveTextContent(
      "Fixture runtime save denied",
    );
    expect(getComputedStyle(feedback).position).toBe("fixed");
    expect(feedback.closest("main")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.documentElement.scrollTop).toBe(1100);
    await act(async () => vi.advanceTimersByTimeAsync(7000));
    expect(within(feedback).getByRole("alert")).toHaveTextContent(
      "Fixture runtime save denied",
    );

    pending = deferred();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Save runtime selection" }),
      );
    });
    expect(
      screen.queryByRole("region", { name: "Operation feedback" }),
    ).toBeNull();
    await act(async () => pending.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(
      within(
        screen.getByRole("region", { name: "Operation feedback" }),
      ).queryByRole("alert"),
    ).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(6500));
    expect(
      screen.queryByRole("region", { name: "Operation feedback" }),
    ).toBeNull();
  });

  it("waits for the post-save snapshot before showing success", async () => {
    await mount();
    await openSettings();
    const refresh = deferred();
    invoke.mockImplementation(async (command, args) => {
      if (command === "snapshot") await refresh.promise;
      return defaultInvoke(command, args);
    });
    await saveRuntime("/test-fixtures/core");
    expect(
      screen.queryByRole("region", { name: "Operation feedback" }),
    ).toBeNull();
    expect(screen.getByLabelText("Executable path")).toBeDisabled();
    await act(async () => refresh.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByLabelText("Executable path")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Save runtime selection" }),
    ).toBeDisabled();
  });

  it("replaces clipboard success and error feedback across repeated copy attempts", async () => {
    snapshot = fixtureSnapshot();
    await mount();
    const copy = screen.getAllByRole("button", { name: "Copy endpoint" })[0];
    await act(async () => fireEvent.click(copy));
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    const pending = deferred();
    clipboard.mockImplementationOnce(() => pending.promise);
    await act(async () => fireEvent.click(copy));
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () =>
      pending.reject(new Error("Fixture clipboard denied")),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Copy failed: Fixture clipboard denied",
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => fireEvent.click(copy));
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps persistent migration and backend refresh notices in the document", async () => {
    snapshot.migrationNotice = "Fixture migration notice";
    await mount();
    await openSettings();
    await saveRuntime("/test-fixtures/core");
    invoke.mockImplementation(async (command, args) => {
      if (command === "snapshot")
        throw new Error("Fixture backend unavailable");
      return defaultInvoke(command, args);
    });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(
      screen.getByText("Fixture migration notice").closest("main"),
    ).not.toBeNull();
    const backendAlert = screen.getByRole("alert", {
      name: "Unable to refresh status",
    });
    expect(backendAlert).toHaveTextContent("Unable to refresh status");
    expect(backendAlert.closest("main")).not.toBeNull();
    const feedback = screen.getByRole("region", { name: "Operation feedback" });
    expect(within(feedback).getByRole("status")).toHaveTextContent("Saved");
    expect(feedback).not.toContainElement(backendAlert);
  });
});
