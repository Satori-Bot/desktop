import { describe, expect, it } from "vitest";
import { blockingOperation } from "./operations";
import type { Operation } from "./operations";

describe("operation admission", () => {
  it.each([
    [
      { key: "save-runtime", workspaceId: "atlas" },
      { key: "start", workspaceId: "atlas" },
    ],
    [
      { key: "stop", workspaceId: "atlas" },
      { key: "stop", workspaceId: "atlas" },
    ],
    [{ key: "install" }, { key: "rollback" }],
    [{ key: "install" }, { key: "cloudflare-login", workspaceId: "birch" }],
    [
      { key: "tunnel-setup", workspaceId: "atlas" },
      { key: "tunnel-setup", workspaceId: "birch" },
    ],
    [{ key: "settings" }, { key: "settings" }],
    [{ key: "quit" }, { key: "stop", workspaceId: "atlas" }],
    [{ key: "stop", workspaceId: "atlas" }, { key: "quit" }],
    [{ key: "install" }, { key: "quit" }],
  ] satisfies [Operation, Operation][])(
    "excludes conflicting %j and %j",
    (current, next) => {
      expect(blockingOperation([current], next)).toBe(current);
    },
  );

  it.each([
    [{ key: "install" }, { key: "stop", workspaceId: "atlas" }],
    [{ key: "install" }, { key: "save-runtime", workspaceId: "atlas" }],
    [{ key: "install" }, { key: "settings" }],
    [
      { key: "stop", workspaceId: "atlas" },
      { key: "stop", workspaceId: "birch" },
    ],
    [
      { key: "save-runtime", workspaceId: "atlas" },
      { key: "save-runtime", workspaceId: "birch" },
    ],
    [
      { key: "tunnel-setup", workspaceId: "atlas" },
      { key: "stop", workspaceId: "birch" },
    ],
  ] satisfies [Operation, Operation][])(
    "admits independent %j and %j",
    (current, next) => {
      expect(blockingOperation([current], next)).toBeUndefined();
    },
  );
});
