/** UI admission mirrors the backend's workspace and shared maintenance locks. */
export interface Operation {
  key: string;
  workspaceId?: string;
}

export const isMaintenance = ({ key }: Operation) =>
  ["install", "rollback", "cloudflare-login", "tunnel-setup"].includes(key);

export function blockingOperation(
  pending: readonly Operation[],
  next: Operation,
): Operation | undefined {
  return pending.find(
    (current) =>
      current.key === "quit" ||
      next.key === "quit" ||
      (!!next.workspaceId && current.workspaceId === next.workspaceId) ||
      (isMaintenance(current) && isMaintenance(next)) ||
      (!current.workspaceId && !next.workspaceId && current.key === next.key),
  );
}
