import type { Page } from "@playwright/test";
import {
  fixtureCalls,
  fixtureSnapshot,
  fixtureStatus,
} from "../src/test/fixtures";
import type { Snapshot } from "../src/types";

type FixtureOptions = {
  empty?: boolean;
  stopped?: boolean;
  tunnelFailure?: boolean;
  errors?: Record<string, string>;
  delays?: Record<string, number>;
};
export async function mockDesktop(page: Page, options: FixtureOptions = {}) {
  await page.addInitScript(
    ({
      initialSnapshot,
      initialCalls,
      runningStatus,
      initialErrors,
      delays,
    }) => {
      type Call = { command: string; args?: Record<string, unknown> };
      const state = {
        snapshot: initialSnapshot,
        calls: [] as Call[],
        errors: initialErrors,
        clipboard: [] as string[],
        logReads: 0,
      };
      const fixtureWindow = window as typeof window & {
        __TEST_FIXTURE__: typeof state;
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
          convertFileSrc: (path: string) => string;
        };
      };
      fixtureWindow.__TEST_FIXTURE__ = state;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            state.clipboard.push(value);
          },
        },
      });
      fixtureWindow.__TAURI_INTERNALS__ = {
        convertFileSrc: (path) => path,
        invoke: async (command, args) => {
          state.calls.push({ command, args });
          if (delays[command])
            await new Promise((resolve) =>
              setTimeout(resolve, delays[command]),
            );
          if (state.errors[command]) throw state.errors[command];
          if (command === "snapshot") return structuredClone(state.snapshot);
          if (command === "activity") return structuredClone(initialCalls);
          if (command === "pick_directory")
            return "/test-fixtures/picked-project";
          if (command === "save_workspace") {
            const workspace = args?.workspace as Snapshot["workspaces"][number];
            const saved = {
              ...workspace,
              id: workspace.id || "created-workspace",
              port: workspace.port || 8766,
            };
            state.snapshot.workspaces = [
              ...state.snapshot.workspaces.filter(
                (item) => item.id !== saved.id,
              ),
              saved,
            ];
            state.snapshot.statuses = [
              ...state.snapshot.statuses.filter(
                (item) => item.workspaceId !== saved.id,
              ),
              {
                ...runningStatus,
                workspaceId: saved.id,
                state: "stopped",
                localState: "offline",
                localEndpoint: "",
              },
            ];
            return structuredClone(saved);
          }
          if (
            command === "start_workspace" ||
            command === "restart_workspace" ||
            command === "stop_workspace"
          ) {
            const next = {
              ...runningStatus,
              workspaceId: String(args?.id),
              ...(command === "stop_workspace"
                ? {
                    state: "stopped" as const,
                    localState: "offline",
                    localEndpoint: "",
                    pid: null,
                  }
                : {}),
            };
            state.snapshot.statuses = [
              ...state.snapshot.statuses.filter(
                (item) => item.workspaceId !== args?.id,
              ),
              next,
            ];
            return structuredClone(next);
          }
          if (command === "retry_tunnel")
            return structuredClone(state.snapshot.statuses[0]);
          if (command === "save_settings") {
            state.snapshot.settings = args?.settings as Snapshot["settings"];
            return structuredClone(state.snapshot.settings);
          }
          if (command === "connection_config")
            return JSON.stringify(
              { mcpServers: { atlas: { url: "http://127.0.0.1:8765/mcp" } } },
              null,
              2,
            );
          if (command === "auth_details")
            return { auth: "bearer", bearerToken: "TEST-ONLY-NONSECRET" };
          if (command === "diagnose")
            return [
              {
                level: "ok",
                name: "Local endpoint",
                message: "TEST FIXTURE: local endpoint verified",
              },
              {
                level: "error",
                name: "Public endpoint",
                message: "TEST FIXTURE: public endpoint unavailable",
              },
            ];
          if (command === "export_diagnostics")
            return JSON.stringify({ fixture: true, credentials: "[REDACTED]" });
          if (command === "logs") {
            state.logReads += 1;
            return {
              text: `TEST FIXTURE ${args?.kind} line ${state.logReads}\n`,
              cursor: state.logReads,
              truncated: false,
            };
          }
          if (command === "delete_workspace") {
            state.snapshot.workspaces = [];
            state.snapshot.statuses = [];
            return null;
          }
          if (command === "open_workspace" || command === "quit_app")
            return null;
          throw new Error(`Unimplemented mock IPC command: ${command}`);
        },
      };
      const labelFixture = () => {
        const label = document.createElement("div");
        label.id = "test-fixture-label";
        label.textContent =
          "TEST FIXTURE / MOCKED IPC · No real runtime or tunnel";
        Object.assign(label.style, {
          position: "fixed",
          right: "12px",
          bottom: "10px",
          zIndex: "9999",
          background: "#4b2689",
          color: "#fff",
          font: "bold 11px system-ui",
          padding: "7px 11px",
          borderRadius: "5px",
          boxShadow: "0 2px 10px #0003",
          pointerEvents: "none",
        });
        document.body.append(label);
      };
      if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", labelFixture, {
          once: true,
        });
      else labelFixture();
    },
    {
      initialSnapshot: fixtureSnapshot(options),
      initialCalls: fixtureCalls,
      runningStatus: fixtureStatus,
      initialErrors: options.errors ?? {},
      delays: options.delays ?? {},
    },
  );
}
export async function ipcCalls(page: Page, command: string) {
  return page.evaluate(
    (name) =>
      (
        window as unknown as {
          __TEST_FIXTURE__: {
            calls: Array<{ command: string; args?: Record<string, unknown> }>;
          };
        }
      ).__TEST_FIXTURE__.calls.filter((call) => call.command === name),
    command,
  );
}
export async function changeError(page: Page, command: string, error?: string) {
  await page.evaluate(
    ({ command, error }) => {
      const fixture = (
        window as unknown as {
          __TEST_FIXTURE__: { errors: Record<string, string> };
        }
      ).__TEST_FIXTURE__;
      if (error) fixture.errors[command] = error;
      else delete fixture.errors[command];
    },
    { command, error },
  );
}
