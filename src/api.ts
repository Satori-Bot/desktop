import { invoke } from "@tauri-apps/api/core";
import type {
  Activity,
  AuthDetails,
  Diagnostic,
  Logs,
  Secrets,
  Settings,
  Snapshot,
  Status,
  Workspace,
} from "./types";
export const backendAvailable = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const call = <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  if (!backendAvailable())
    return Promise.reject(
      new Error(
        "Desktop backend unavailable. Open the installed desktop app to manage workspaces.",
      ),
    );
  return invoke<T>(command, args);
};
export const api = {
  snapshot: () => call<Snapshot>("snapshot"),
  saveWorkspace: (workspace: Workspace, secrets?: Secrets) =>
    call<Workspace>("save_workspace", { workspace, secrets }),
  deleteWorkspace: (id: string) => call<void>("delete_workspace", { id }),
  start: (id: string) => call<Status>("start_workspace", { id }),
  stop: (id: string) => call<Status>("stop_workspace", { id }),
  restart: (id: string) => call<Status>("restart_workspace", { id }),
  retryTunnel: (id: string) => call<Status>("retry_tunnel", { id }),
  activity: (id: string) => call<Activity[]>("activity", { id }),
  logs: (id: string, kind: "runtime" | "tunnel", cursor = 0) =>
    call<Logs>("logs", { id, kind, cursor }),
  checkPublicRoute: (id: string) => call<string>("check_public_route", { id }),
  diagnose: (id: string) => call<Diagnostic[]>("diagnose", { id }),
  exportDiagnostics: (id: string) => call<string>("export_diagnostics", { id }),
  connectionConfig: (id: string, isPublic: boolean) =>
    call<string>("connection_config", { id, public: isPublic }),
  copyText: (text: string) => call<boolean>("copy_text", { text }),
  authDetails: (id: string) => call<AuthDetails>("auth_details", { id }),
  saveSettings: (settings: Settings) =>
    call<Settings>("save_settings", { settings }),
  validateWorkspacePath: (path: string) =>
    call<string>("validate_workspace_path", { path }),
  validateCoreOverride: (path: string, args: string[]) =>
    call<void>("validate_core_override", { path, args }),
  pickCoreExecutable: () => call<string | null>("pick_core_executable"),
  pickDirectory: () => call<string | null>("pick_directory"),
  openWorkspace: (id: string) => call<void>("open_workspace", { id }),
  installCore: (version: string) => call<string>("install_core", { version }),
  openInstallLogs: () => call<void>("open_install_logs"),
  openSetupHelp: (topic: "core" | "cloudflare") =>
    call<void>("open_setup_help", { topic }),
  rollbackCore: () => call<string>("rollback_core"),
  cloudflareLogin: () => call<string>("cloudflare_login"),
  setupNamedTunnel: (id: string, name: string, hostname: string) =>
    call<Workspace>("setup_named_tunnel", { id, name, hostname }),
  quit: () => call<void>("quit_app"),
};
