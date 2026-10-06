/** TEST FIXTURES ONLY. Never import these records into the production application. */
import type { Activity, Snapshot, Status, Workspace } from "../types";
export const fixtureWorkspace: Workspace = {
  id: "test-workspace",
  name: "Atlas workspace",
  path: "/test-fixtures/atlas",
  port: 8765,
  access: "local",
  publicUrl: "",
  auth: "noauth",
  permissionMode: "safe",
  coreCommand: [],
  coreVersion: "0.9.0-test",
  tunnelName: "",
  credentialsFile: "",
  tokenConfigured: false,
};
export const fixtureStatus: Status = {
  workspaceId: fixtureWorkspace.id,
  state: "running",
  pid: 4242,
  localState: "online",
  publicState: "disabled",
  localMessage: "Test fixture: local health check passed.",
  publicMessage: "",
  localEndpoint: "http://127.0.0.1:8765/mcp",
  publicEndpoint: "",
  cpuPercent: 2.4,
  memoryBytes: 72 * 1024 * 1024,
  uptimeSeconds: 3744,
  checkedAt: "2026-10-06T06:00:00Z",
  coreVersion: "0.9.0-test",
};
export const fixtureCalls: Activity[] = [
  {
    id: "call-one",
    tool: "read_file",
    startedAt: "2026-10-06T06:02:00Z",
    finishedAt: "2026-10-06T06:02:01Z",
    outcome: "success",
    durationMs: 41,
    errorCategory: null,
    runtimeId: "test-runtime",
  },
  {
    id: "call-two",
    tool: "execute_command",
    startedAt: "2026-10-06T06:01:00Z",
    finishedAt: "2026-10-06T06:01:01Z",
    outcome: "error",
    durationMs: 212,
    errorCategory: "permission_denied",
    runtimeId: "test-runtime",
  },
  {
    id: "call-three",
    tool: "search_code",
    startedAt: "2026-10-06T06:00:00Z",
    finishedAt: null,
    outcome: "pending",
    durationMs: null,
    errorCategory: null,
    runtimeId: "test-runtime",
  },
];
export function fixtureSnapshot(
  options: { empty?: boolean; stopped?: boolean; tunnelFailure?: boolean } = {},
): Snapshot {
  const workspace = { ...fixtureWorkspace, coreCommand: [] };
  const status = { ...fixtureStatus };
  if (options.stopped)
    Object.assign(status, {
      state: "stopped",
      pid: null,
      localState: "offline",
      localEndpoint: "",
      cpuPercent: 0,
      memoryBytes: 0,
      uptimeSeconds: 0,
      localMessage: "",
    });
  if (options.tunnelFailure) {
    Object.assign(workspace, {
      access: "named",
      auth: "bearer",
      publicUrl: "https://mcp.example.test",
      tunnelName: "atlas-test",
      tokenConfigured: true,
    });
    Object.assign(status, {
      publicState: "error",
      publicMessage: "Test fixture: Cloudflare tunnel authentication failed.",
      publicEndpoint: "",
    });
  }
  return {
    workspaces: options.empty ? [] : [workspace],
    statuses: options.empty ? [] : [status],
    settings: { language: "en", closeToTray: true },
    migrationNotice: null,
    coreAvailable: true,
    cloudflaredAvailable: true,
  };
}
