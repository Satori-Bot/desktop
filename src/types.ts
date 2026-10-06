export type Access = "local" | "quick" | "named" | "frp";
export interface Workspace {
  id: string;
  name: string;
  path: string;
  port: number;
  access: Access;
  publicUrl: string;
  auth: "noauth" | "bearer" | "oauth";
  permissionMode: "safe" | "trusted";
  coreCommand: string[];
  coreVersion: string;
  tunnelName: string;
  credentialsFile: string;
  tokenConfigured: boolean;
}
export interface Secrets {
  bearerToken?: string;
  oauthPassword?: string;
  cloudflareToken?: string;
}
export interface Settings {
  language: "en" | "zh";
  closeToTray: boolean;
}
export interface Status {
  workspaceId: string;
  state: "stopped" | "starting" | "running" | "error" | "stopping";
  pid: number | null;
  cleanupPending?: boolean;
  localState: string;
  publicState: string;
  localMessage: string;
  publicMessage: string;
  localEndpoint: string;
  publicEndpoint: string;
  cpuPercent: number;
  memoryBytes: number;
  uptimeSeconds: number;
  checkedAt: string;
  coreVersion: string;
  activityState?: "available" | "unavailable" | "unknown";
  activityMessage?: string;
}
export interface Activity {
  id: string;
  tool: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
  durationMs: number | null;
  errorCategory: string | null;
  runtimeId: string;
}
export const activityOutcome = (call: Activity) =>
  call.outcome === "interrupted"
    ? "interrupted"
    : !call.finishedAt
      ? "pending"
      : ["success", "ok", "completed"].includes(call.outcome)
        ? "success"
        : "failed";
export interface Snapshot {
  workspaces: Workspace[];
  statuses: Status[];
  settings: Settings;
  migrationNotice: string | null;
  coreAvailable: boolean;
  cloudflaredAvailable: boolean;
}
export interface Diagnostic {
  level: "ok" | "warning" | "error";
  name: string;
  message: string;
}
export interface Logs {
  text: string;
  cursor: number;
  truncated: boolean;
}
export const blankWorkspace = (): Workspace => ({
  id: "",
  name: "",
  path: "",
  port: 0,
  access: "local",
  publicUrl: "",
  auth: "noauth",
  permissionMode: "safe",
  coreCommand: [],
  coreVersion: "0.5.0",
  tunnelName: "",
  credentialsFile: "",
  tokenConfigured: false,
});
export const isActive = (s?: Status) =>
  !!s &&
  (s.cleanupPending ||
    s.pid !== null ||
    ["running", "starting", "stopping"].includes(s.state));
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export interface AuthDetails {
  auth: string;
  bearerToken?: string;
  oauthPassword?: string;
}
