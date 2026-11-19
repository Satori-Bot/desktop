import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFocusReturn } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Cloud,
  Download,
  Eye,
  Globe2,
  KeyRound,
  LockKeyhole,
  Search,
  Settings2,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { api } from "../api";
import type {
  Activity,
  AuthDetails,
  Diagnostic,
  Settings,
  Status,
  Workspace,
} from "../types";
import {
  activityOutcome,
  errorText,
  isActive,
  RECOMMENDED_CORE_VERSION,
} from "../types";
import { useSavedDraft } from "../hooks/useSavedDraft";
import { usePageActive } from "../hooks/usePageActive";
import { SecretInput } from "./SecretInput";
import type { Translate } from "../i18n";
import type { RunAction } from "../App";
import { CallList, Empty, EndpointCard, SectionHead } from "./Common";
import { ConfirmModal } from "./WorkspaceModal";
function configWarning(
  status: Status | undefined,
  isPublic: boolean,
  t: Translate,
) {
  const state = isPublic ? status?.publicState : status?.localState;
  if (["online", "ready", "ok"].includes(state ?? "")) return "";
  if (!isPublic && state && !["offline", "stopped"].includes(state)) {
    return t(
      "Local service is not ready. You can copy this configuration, but confirm it is running and healthy before connecting a client.",
    );
  }
  return t(
    isPublic
      ? "Public access is not verified. You can copy this configuration, but check the connection before using it."
      : "Local service is offline. You can copy this configuration, but start the workspace before connecting a client.",
  );
}
export function ConnectionsPage({
  workspace,
  status,
  run,
  busy,
  maintenanceBusy = "",
  t,
  onEdit,
  onRemove,
  onCopy,
  onSaved,
}: {
  workspace: Workspace;
  status?: Status;
  run: RunAction;
  busy: string;
  maintenanceBusy?: string;
  t: Translate;
  onEdit: () => void;
  onRemove: () => void;
  onCopy: (text: string, success?: string) => Promise<void>;
  onSaved: (w: Workspace) => void;
}) {
  const pageActive = usePageActive();
  const workspaceKey = JSON.stringify(workspace);
  const localKey = JSON.stringify([workspaceKey, status?.localEndpoint]);
  const publicKey = JSON.stringify([workspaceKey, status?.publicEndpoint]);
  const latestConnection = useRef({
    workspaceKey,
    localKey,
    publicKey,
    status,
    t,
  });
  useLayoutEffect(() => {
    latestConnection.current = { workspaceKey, localKey, publicKey, status, t };
  }, [workspaceKey, localKey, publicKey, status, t]);
  const [shownConfig, setConfig] = useState<{
    text: string;
    isPublic: boolean;
    key: string;
  } | null>(null);
  const [shownCredentials, setCredentials] = useState<{
    value: AuthDetails;
    key: string;
  } | null>(null);
  const config =
    shownConfig?.key === (shownConfig?.isPublic ? publicKey : localKey)
      ? shownConfig
      : null;
  const credentials =
    shownCredentials?.key === workspaceKey ? shownCredentials.value : null;
  useEffect(() => {
    if (shownConfig && !config) setConfig(null);
    if (shownCredentials && !credentials) setCredentials(null);
  }, [shownConfig, config, shownCredentials, credentials]);
  const [tunnelName, setTunnelName] = useState(
    workspace.tunnelName ||
      workspace.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase(),
  );
  const [hostname, setHostname] = useState(() => {
    try {
      return new URL(workspace.publicUrl).hostname;
    } catch {
      return "";
    }
  });
  const [confirm, setConfirm] = useState(false);
  const tunnelCreated = useRef(false);
  useFocusReturn({
    opened: confirm,
    shouldReturnFocus: !tunnelCreated.current,
  });
  const [loginOutput, setLoginOutput] = useState("");
  const [validation, setValidation] = useState("");
  const active = isActive(status);
  const setupBusy = busy || maintenanceBusy;
  const canCheckPublic = workspace.access === "frp" || !!status?.publicEndpoint;
  async function showConfig(isPublic: boolean, copyOnly = false) {
    const key = isPublic ? publicKey : localKey;
    const result = await run(copyOnly ? "copy-config" : "config", () =>
      api.connectionConfig(workspace.id, isPublic),
    );
    const latest = latestConnection.current;
    if (
      pageActive.current &&
      result !== undefined &&
      key === (isPublic ? latest.publicKey : latest.localKey)
    ) {
      if (copyOnly) {
        const warning = configWarning(latest.status, isPublic, latest.t);
        await onCopy(
          result,
          [latest.t("Copied"), warning].filter(Boolean).join(" "),
        );
      } else {
        setConfig({ text: result, isPublic, key });
      }
    }
  }
  async function showCredentials() {
    const result = await run("credentials", () =>
      api.authDetails(workspace.id),
    );
    if (
      pageActive.current &&
      result &&
      workspaceKey === latestConnection.current.workspaceKey
    ) {
      setCredentials({ value: result, key: workspaceKey });
    }
  }
  function requestTunnel() {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(tunnelName) ||
      !/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(hostname)
    ) {
      setValidation(t("Enter a tunnel name and a valid hostname."));
      return;
    }
    setValidation("");
    tunnelCreated.current = false;
    setConfirm(true);
  }
  async function createTunnel() {
    const result = await run(
      "tunnel-setup",
      async () => {
        const saved = await api.setupNamedTunnel(
          workspace.id,
          tunnelName,
          hostname,
        );
        onSaved(saved);
        return saved;
      },
      t("Operation completed"),
    );
    if (pageActive.current && result) {
      tunnelCreated.current = true;
      setConfirm(false);
    }
  }
  return (
    <Stack gap="lg">
      <SectionHead
        title={t("Access and authentication")}
        detail={t("Local and public connections are monitored independently.")}
      >
        <Button
          variant="default"
          leftSection={<Settings2 size={15} />}
          disabled={active || !!busy}
          onClick={onEdit}
        >
          {t("Edit workspace")}
        </Button>
      </SectionHead>
      {active && (
        <Text c="dimmed" size="xs">
          {t("Stop this workspace before changing its configuration.")}
        </Text>
      )}
      <div className="endpoint-grid">
        <div className="connection-endpoint">
          <EndpointCard
            status={status}
            access={workspace.access}
            isPublic={false}
            t={t}
            onCopy={onCopy}
            busy={!!busy}
          />
          <Group mt="sm" className="connection-config-actions">
            <Button
              size="xs"
              variant="default"
              leftSection={<Clipboard size={14} />}
              disabled={!!busy || !status?.localEndpoint}
              onClick={() => void showConfig(false, true)}
            >
              {t("Copy config")}
            </Button>
            <Button
              size="xs"
              variant="subtle"
              disabled={!!busy || !status?.localEndpoint}
              onClick={() => void showConfig(false)}
            >
              {t("View configuration")}
            </Button>
          </Group>
          {status?.localEndpoint && configWarning(status, false, t) && (
            <Alert color="yellow" mt="sm">
              {configWarning(status, false, t)}
            </Alert>
          )}
        </div>
        <div className="connection-endpoint">
          <EndpointCard
            status={status}
            access={workspace.access}
            isPublic
            t={t}
            onCopy={onCopy}
            busy={!!busy}
          />
          <Group mt="sm" className="connection-config-actions">
            <Button
              size="xs"
              variant="default"
              leftSection={<Clipboard size={14} />}
              disabled={!!busy || !status?.publicEndpoint}
              onClick={() => void showConfig(true, true)}
            >
              {t("Copy config")}
            </Button>
            <Button
              size="xs"
              variant="subtle"
              disabled={!!busy || !status?.publicEndpoint}
              onClick={() => void showConfig(true)}
            >
              {t("View configuration")}
            </Button>
            {workspace.access !== "local" && (
              <Button
                size="xs"
                color="orange"
                variant="light"
                disabled={!!busy || status?.state !== "running"}
                loading={
                  busy === (canCheckPublic ? "diagnose" : "retry-tunnel")
                }
                onClick={() => {
                  if (canCheckPublic) {
                    void run(
                      "diagnose",
                      () => api.checkPublicRoute(workspace.id),
                      t("Public discovery is reachable"),
                    );
                  } else {
                    void run("retry-tunnel", () =>
                      api.retryTunnel(workspace.id),
                    );
                  }
                }}
              >
                {t(canCheckPublic ? "Check public address" : "Retry tunnel")}
              </Button>
            )}
            {canCheckPublic &&
              workspace.access !== "frp" &&
              status?.publicState === "error" && (
                <Button
                  size="xs"
                  variant="subtle"
                  disabled={!!busy}
                  onClick={() =>
                    void run("retry-tunnel", () =>
                      api.retryTunnel(workspace.id),
                    )
                  }
                >
                  {t("Retry tunnel")}
                </Button>
              )}
          </Group>
          {status?.publicCheckedAt && (
            <Text c="dimmed" size="xs" mt="xs">
              {t("Last public discovery check")}:{" "}
              {new Date(status.publicCheckedAt).toLocaleString()}
            </Text>
          )}
          {status?.publicEndpoint && configWarning(status, true, t) && (
            <Alert color="yellow" mt="sm">
              {configWarning(status, true, t)}
            </Alert>
          )}
        </div>
      </div>
      {workspace.access === "quick" && (
        <Alert
          color="yellow"
          title={t("Temporary Quick Tunnel")}
          icon={<Cloud size={18} />}
        >
          {t(
            "This URL changes after a restart. Use a named tunnel for a stable address and browser authentication.",
          )}
        </Alert>
      )}
      <Paper withBorder p="lg" className="connection-authentication">
        <Group justify="space-between">
          <Group>
            <div className="panel-icon">
              <LockKeyhole size={20} />
            </div>
            <div>
              <Text fw={650}>{t("Authentication")}</Text>
              <Text size="sm" c="dimmed">
                {t(
                  workspace.auth === "oauth"
                    ? "Browser sign-in (OAuth)"
                    : workspace.auth === "bearer"
                      ? "Bearer token"
                      : "No authentication (local only)",
                )}
              </Text>
            </div>
          </Group>
          <Button
            variant="light"
            size="sm"
            leftSection={<Eye size={15} />}
            disabled={!!busy || workspace.auth === "noauth"}
            onClick={() => void showCredentials()}
          >
            {t("Show credentials")}
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="md">
          {t(
            "Secrets stay in your local desktop configuration. Never paste them into issue reports.",
          )}
        </Text>
        {workspace.auth === "oauth" && (
          <Text size="xs" c="dimmed" mt="xs">
            {t(
              "Use Show credentials to find the password for your MCP client's browser sign-in.",
            )}
          </Text>
        )}
        {workspace.auth === "bearer" && (
          <Text size="xs" c="dimmed" mt="xs">
            {t("Configuration may contain credentials. Keep it private.")}
          </Text>
        )}
      </Paper>
      {workspace.auth === "oauth" && (
        <Alert color="blue" icon={<Globe2 size={17} />}>
          {t(
            "After restarting or upgrading the core, reconnect your MCP client. If authorization fails, remove this server's saved authorization in the client and sign in again using the password from Show credentials.",
          )}
        </Alert>
      )}
      <Paper withBorder p="xl">
        <Group gap="md" mb="md">
          <div className="panel-icon cloud">
            <Cloud size={23} />
          </div>
          <div>
            <Title order={3} size="h4">
              {t("Stable Cloudflare tunnel")}
            </Title>
            <Text c="dimmed" size="sm">
              {t(
                "Use your domain with a reusable tunnel and browser-based OAuth.",
              )}
            </Text>
          </div>
          <Badge ml="auto" color="teal" variant="light">
            HTTPS
          </Badge>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          {t(
            "Cloudflare will open your browser. Sign in and select a domain you own.",
          )}
        </Text>
        {workspace.access !== "named" ? (
          <Button
            variant="light"
            onClick={onEdit}
            disabled={active || !!setupBusy}
          >
            {t("Configure access")}
          </Button>
        ) : (
          <Stack>
            <Button
              w="fit-content"
              variant="default"
              leftSection={<Globe2 size={16} />}
              disabled={active || !!setupBusy}
              loading={setupBusy === "cloudflare-login"}
              onClick={async () => {
                const output = await run(
                  "cloudflare-login",
                  api.cloudflareLogin,
                );
                if (pageActive.current && output) setLoginOutput(output);
              }}
            >
              {t("Authorize Cloudflare")}
            </Button>
            {loginOutput && (
              <Alert color="blue" className="break-word">
                {loginOutput}
              </Alert>
            )}
            <div className="form-two-col">
              <TextInput
                label={t("Tunnel name")}
                value={tunnelName}
                onChange={(e) => setTunnelName(e.currentTarget.value)}
                disabled={active || !!setupBusy}
              />
              <TextInput
                label={t("Hostname")}
                placeholder="mcp.example.com"
                value={hostname}
                onChange={(e) => setHostname(e.currentTarget.value)}
                disabled={active || !!setupBusy}
              />
            </div>
            {validation && (
              <Text c="red" size="sm" role="alert">
                {validation}
              </Text>
            )}
            <Button
              w="fit-content"
              leftSection={<Cloud size={16} />}
              disabled={active || !!setupBusy}
              onClick={requestTunnel}
            >
              {t("Create tunnel and DNS")}
            </Button>
            <Text c="dimmed" size="xs">
              {t(
                "This creates a Cloudflare tunnel and a DNS record in your account.",
              )}
            </Text>
          </Stack>
        )}
      </Paper>
      <Paper withBorder p="lg">
        <Group justify="space-between">
          <div>
            <Text fw={650}>{t("Workspace details")}</Text>
            <Group mt="xs">
              <Badge variant="light" color="gray">
                {t(workspace.permissionMode === "safe" ? "Safe" : "Trusted")}
              </Badge>
              <Text c="dimmed" size="sm">
                {t("Port")}: {workspace.port || t("Automatic")}
              </Text>
            </Group>
          </div>
          <Button
            color="red"
            variant="subtle"
            size="sm"
            leftSection={<Trash2 size={15} />}
            disabled={active || !!busy}
            onClick={onRemove}
          >
            {t("Remove workspace")}
          </Button>
        </Group>
      </Paper>
      <Modal
        opened={config !== null}
        onClose={() => setConfig(null)}
        title={t("Configure your client")}
        closeButtonProps={{ "aria-label": t("Close") }}
        size="lg"
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t(
              "Paste the configuration into an MCP-compatible client. It reflects saved settings only.",
            )}
          </Text>
          <Alert color="yellow">
            {t("Configuration may contain credentials. Keep it private.")}
          </Alert>
          {config && configWarning(status, config.isPublic, t) && (
            <Alert color="yellow">
              {configWarning(status, config.isPublic, t)}
            </Alert>
          )}
          <Code block className="config-code">
            {config?.text}
          </Code>
          <Button
            leftSection={<Clipboard size={15} />}
            loading={busy === "copy-config"}
            disabled={!!busy && busy !== "copy-config"}
            onClick={() => config && void showConfig(config.isPublic, true)}
          >
            {t("Copy config")}
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={credentials !== null}
        onClose={() => setCredentials(null)}
        title={t("Show credentials")}
        closeButtonProps={{ "aria-label": t("Close") }}
        centered
      >
        <Stack>
          <Alert color="yellow" icon={<KeyRound size={17} />}>
            {t(
              "Secrets stay in your local desktop configuration. Never paste them into issue reports.",
            )}
          </Alert>
          {credentials?.bearerToken && (
            <SecretInput
              t={t}
              label={t("Bearer token")}
              value={credentials.bearerToken}
              readOnly
            />
          )}
          {credentials?.oauthPassword && (
            <SecretInput
              t={t}
              label={t("OAuth password")}
              value={credentials.oauthPassword}
              readOnly
            />
          )}
          <Button variant="default" onClick={() => setCredentials(null)}>
            {t("Close")}
          </Button>
        </Stack>
      </Modal>
      {confirm && (
        <ConfirmModal
          title={t("Create tunnel and DNS")}
          detail={`${t("This creates a Cloudflare tunnel and a DNS record in your account.")} ${tunnelName} → ${hostname}`}
          label={t("Create tunnel and DNS")}
          onClose={() => setConfirm(false)}
          onConfirm={() => void createTunnel()}
          busy={!!setupBusy}
          t={t}
        />
      )}
    </Stack>
  );
}
export function ActivityPage({
  calls,
  error,
  status,
  language,
  t,
}: {
  calls: Activity[];
  error: string;
  status?: Status;
  language: string;
  t: Translate;
}) {
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");
  const filtered = calls.filter(
    (call) =>
      call.tool.toLowerCase().includes(search.toLowerCase()) &&
      (outcome === "all" || outcome === activityOutcome(call)),
  );
  return (
    <Stack gap="lg">
      <SectionHead
        title={t("Activity")}
        detail={t(
          "Real tool calls from your running workspace. Latest 200 calls.",
        )}
      >
        <Badge variant="light" size="lg">
          {filtered.length} / {calls.length}
        </Badge>
      </SectionHead>
      {status?.activityState === "unavailable" && (
        <Alert
          color="yellow"
          title={t("Tool history unavailable")}
          icon={<AlertCircle size={18} />}
        >
          {t(
            "This Core can run tools, but does not record tool-call history. You can still connect and use it.",
          )}
          {status.activityMessage && (
            <Text size="xs" mt="xs">
              {t(status.activityMessage)}
            </Text>
          )}
        </Alert>
      )}
      <div className="activity-filters">
        <TextInput
          aria-label={t("Search tools")}
          placeholder={t("Search tools")}
          leftSection={<Search size={17} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Select
          aria-label={t("All outcomes")}
          value={outcome}
          onChange={(v) => setOutcome(v ?? "all")}
          allowDeselect={false}
          data={[
            { value: "all", label: t("All outcomes") },
            { value: "success", label: t("Success") },
            { value: "failed", label: t("Failed") },
            { value: "interrupted", label: t("Interrupted") },
            { value: "pending", label: t("In progress") },
          ]}
        />
      </div>
      {error && (
        <Alert color="red" title={t("Could not load activity")}>
          {t(error)}
        </Alert>
      )}
      <Paper withBorder>
        {calls.length && !filtered.length ? (
          <Empty
            icon={<Search size={24} />}
            title={t("No matching calls")}
            detail={t("Try another search or filter.")}
          />
        ) : (
          <CallList
            calls={filtered}
            unavailable={status?.activityState === "unavailable"}
            t={t}
            language={language}
          />
        )}
      </Paper>
    </Stack>
  );
}
export function DiagnosticsPage({
  workspace,
  status,
  run,
  busy,
  t,
}: {
  workspace: Workspace;
  status?: Status;
  run: RunAction;
  busy: string;
  t: Translate;
}) {
  const signature = JSON.stringify([
    workspace,
    status?.pid,
    status?.state,
    status?.localState,
    status?.publicEndpoint,
  ]);
  const [lastCheck, setLastCheck] = useState<{
    rows: Diagnostic[];
    signature: string;
    at: number;
  } | null>(null);
  const checks = lastCheck?.rows ?? null;
  const stale =
    lastCheck !== null &&
    (signature !== lastCheck.signature || Date.now() - lastCheck.at >= 300_000);
  const [kind, setKind] = useState<"runtime" | "tunnel">("runtime");
  const [logs, setLogs] = useState("");
  const cursor = useRef(0);
  const [logError, setLogError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const logsBusy = useRef(false);
  const generation = useRef(0);
  const [reading, setReading] = useState(false);
  async function readLogs(reset = false) {
    if (logsBusy.current && !reset) return;
    const sequence = ++generation.current;
    logsBusy.current = true;
    setReading(true);
    try {
      const result = await api.logs(
        workspace.id,
        kind,
        reset ? 0 : cursor.current,
      );
      if (sequence !== generation.current) return;
      const restarted = result.cursor === 0 && cursor.current !== 0;
      setLogs((current) =>
        `${reset || result.truncated || restarted ? "" : current}${result.text}`.slice(
          -100000,
        ),
      );
      cursor.current = result.cursor;
      const clipped =
        (reset || result.truncated || restarted ? 0 : logs.length) +
          result.text.length >
        100000;
      setTruncated((previous) =>
        reset
          ? result.truncated || clipped
          : previous || result.truncated || restarted || clipped,
      );
      setLogError("");
    } catch (e) {
      if (sequence === generation.current) setLogError(errorText(e));
    } finally {
      if (sequence === generation.current) {
        logsBusy.current = false;
        setReading(false);
      }
    }
  }
  useEffect(() => {
    setLogs("");
    setLogError("");
    setTruncated(false);
    cursor.current = 0;
    void readLogs(true);
    return () => {
      ++generation.current;
    };
  }, [kind, workspace.id]);
  async function diagnose() {
    const result = await run("diagnose", () => api.diagnose(workspace.id));
    if (result) setLastCheck({ rows: result, signature, at: Date.now() });
  }
  async function exportReport() {
    await run(
      "export",
      async () => {
        const text = await api.exportDiagnostics(workspace.id);
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `coding-tools-diagnostics-${workspace.name.replace(/[^\w-]/g, "_")}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
      },
      t("Diagnostics exported"),
    );
  }
  return (
    <Stack gap="lg">
      <SectionHead
        title={t("Check your setup")}
        detail={t(
          "Checks cover runtime, folder access, and local/public connectivity.",
        )}
      >
        <Group>
          <Button
            variant="default"
            leftSection={<Download size={15} />}
            disabled={!!busy}
            onClick={() => void exportReport()}
          >
            {t("Export diagnostics")}
          </Button>
          <Button
            leftSection={<Wrench size={15} />}
            loading={busy === "diagnose"}
            disabled={!!busy && busy !== "diagnose"}
            onClick={() => void diagnose()}
          >
            {t("Run checks")}
          </Button>
        </Group>
      </SectionHead>
      <Paper withBorder>
        {checks === null ? (
          <Empty
            icon={<Wrench size={25} />}
            title={t("Diagnostics")}
            detail={t("Run diagnostics to see what needs attention.")}
          />
        ) : checks.length === 0 ? (
          <Empty
            icon={<CheckCircle2 size={25} />}
            title={t("No checks returned")}
            detail={t("Run checks again or inspect the runtime logs.")}
          />
        ) : (
          <div className="diagnostic-list">
            {lastCheck && (
              <Text size="sm" c={stale ? "yellow" : "dimmed"}>
                {t(
                  stale
                    ? "Previous checks are stale. Run checks again."
                    : "Last diagnostics check",
                )}
                {": "}
                {new Date(lastCheck.at).toLocaleString()}
              </Text>
            )}
            {checks.map((item, index) => (
              <div key={`${item.name}-${index}`} className="diagnostic-row">
                <div
                  className={`diagnostic-icon ${stale ? "warning" : item.level}`}
                >
                  {!stale && item.level === "ok" ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <AlertCircle size={19} />
                  )}
                </div>
                <div>
                  <Text fw={600} size="sm">
                    {t(item.name)}
                  </Text>
                  <Text size="sm" c="dimmed" className="break-word">
                    {t(item.message)}
                  </Text>
                </div>
                <Badge
                  ml="auto"
                  color={
                    stale
                      ? "gray"
                      : item.level === "ok"
                        ? "teal"
                        : item.level === "error"
                          ? "red"
                          : "yellow"
                  }
                  variant="light"
                >
                  {t(
                    stale
                      ? "Stale"
                      : item.level === "ok"
                        ? "Ready"
                        : item.level === "error"
                          ? "Error"
                          : "Warning",
                  )}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Paper>
      <Text size="xs" c="dimmed">
        {t("Redacted report. Review the file before sharing.")}
      </Text>
      <Paper withBorder className="logs-panel">
        <div className="panel-title">
          <Group>
            <Terminal size={18} />
            <SegmentedControl
              size="xs"
              value={kind}
              onChange={(value) => setKind(value as "runtime" | "tunnel")}
              data={[
                { value: "runtime", label: t("Runtime logs") },
                { value: "tunnel", label: t("Tunnel logs") },
              ]}
            />
          </Group>
          <Button
            size="xs"
            variant="default"
            loading={reading}
            onClick={() => void readLogs()}
          >
            {t("Refresh logs")}
          </Button>
        </div>
        {logError && (
          <Alert color="red" m="md">
            {t(logError)}
          </Alert>
        )}
        {truncated && (
          <Text px="lg" pt="sm" c="dimmed" size="xs">
            {t(
              "Log output was truncated or restarted. Showing the latest available segment.",
            )}
          </Text>
        )}
        <pre className="log-output">{logs || t("No logs available")}</pre>
      </Paper>
    </Stack>
  );
}
const sameSettings = (a: Settings, b: Settings) =>
  a.language === b.language && a.closeToTray === b.closeToTray;

export function SettingsPage({
  settings,
  available,
  coreAvailable,
  rollbackAvailable,
  cloudflaredAvailable,
  run,
  busy,
  maintenanceBusy,
  runtimeBusy,
  anyBusy,
  runWorkspace,
  onQuit,
  onSettingsSaved,
  workspace,
  status,
  onSaved,
  onContinue,
  t,
}: {
  settings: Settings;
  available: boolean;
  coreAvailable: boolean | null;
  rollbackAvailable?: boolean;
  cloudflaredAvailable: boolean | null;
  run: RunAction;
  busy: string;
  maintenanceBusy: string;
  runtimeBusy: string;
  anyBusy: boolean;
  runWorkspace: RunAction;
  onQuit: () => void;
  onSettingsSaved: (settings: Settings) => void;
  workspace?: Workspace;
  status?: Status;
  onSaved: (workspace: Workspace) => void;
  onContinue: () => void;
  t: Translate;
}) {
  const pageActive = usePageActive();
  const [draft, setDraft] = useSavedDraft(settings, sameSettings);
  const dirty = !sameSettings(draft, settings);
  const [version, setVersion] = useState("");
  const [validation, setValidation] = useState("");
  const [output, setOutput] = useState("");
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  async function save() {
    const result = await run(
      "settings",
      async () => {
        const saved = await api.saveSettings(draft);
        onSettingsSaved(saved);
        return saved;
      },
      t("Saved"),
    );
    if (pageActive.current && result) setDraft(result);
  }
  async function install(value = version) {
    const exactVersion = value.trim();
    // Match the manager's published-version contract before invoking IPC.
    if (!/^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(exactVersion)) {
      setValidation(t("Enter an exact version, for example 0.5.0."));
      return;
    }
    setValidation("");
    const result = await run(
      "install",
      () => api.installCore(exactVersion),
      t("Core installation completed"),
    );
    if (pageActive.current && result) setOutput("Core installation completed");
  }
  return (
    <Stack gap="xl">
      <SectionHead
        title={t("Preferences")}
        detail={t("Make this workspace feel like yours.")}
      />
      <Paper withBorder p="xl">
        <div className="settings-row">
          <div>
            <Text fw={600}>{t("Language")}</Text>
            <Text c="dimmed" size="sm">
              English / 简体中文
            </Text>
          </div>
          <Select
            aria-label={t("Language")}
            value={draft.language}
            onChange={(language) => {
              if (language) {
                setDraft({
                  ...draft,
                  language: language as Settings["language"],
                });
              }
            }}
            data={[
              { value: "en", label: "English" },
              { value: "zh", label: "简体中文" },
            ]}
            allowDeselect={false}
            disabled={!!busy || !available}
            w={200}
          />
        </div>
        <Divider my="lg" />
        <div className="settings-row">
          <Text fw={600}>{t("Appearance")}</Text>
          <SegmentedControl
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "light" | "dark")}
            data={[
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
            ]}
          />
        </div>
        <Divider my="lg" />
        <div className="settings-row">
          <div>
            <Text fw={600}>{t("Close to tray")}</Text>
            <Text c="dimmed" size="sm" maw={550}>
              {t(
                "Keep services running when the window closes. Use Quit to stop all services.",
              )}
            </Text>
          </div>
          <Switch
            aria-label={t("Close to tray")}
            checked={draft.closeToTray}
            disabled={!!busy || !available}
            onChange={(event) => {
              setDraft({ ...draft, closeToTray: event.currentTarget.checked });
            }}
          />
        </div>
        <Group justify="end" mt="xl">
          <Button
            onClick={() => void save()}
            loading={busy === "settings"}
            disabled={!available || (!!busy && busy !== "settings") || !dirty}
          >
            {t("Save changes")}
          </Button>
        </Group>
      </Paper>
      <Paper withBorder p="xl">
        <Group mb="md">
          <div className="panel-icon">
            <Terminal size={22} />
          </div>
          <div>
            <Title order={3} size="h4">
              {t("Managed core")}
            </Title>
            <Text size="sm" c="dimmed">
              {t(
                "Install a verified version of the external coding-tools-mcp runtime.",
              )}
            </Text>
          </div>
          <Badge
            ml="auto"
            color={coreAvailable ? "teal" : "orange"}
            variant="light"
          >
            {t(
              coreAvailable === null
                ? "Unknown"
                : coreAvailable
                  ? "Installed"
                  : "Missing",
            )}
          </Badge>
        </Group>
        <Alert color="yellow" mb="lg">
          {t(
            "The recommended Core 0.5.0 works for connecting and running tools. Tool-call history is not included in this release.",
          )}
        </Alert>
        <Button
          mb="md"
          onClick={() => void install(RECOMMENDED_CORE_VERSION)}
          loading={maintenanceBusy === "install"}
          disabled={!available || !!maintenanceBusy}
        >
          {t("Install recommended Core")} ({RECOMMENDED_CORE_VERSION})
        </Button>
        <div className="core-install">
          <TextInput
            label={t("Version to install")}
            placeholder={t("For example, 0.5.0")}
            description={t(
              "Enter a published version. The example is not filled in automatically.",
            )}
            value={version}
            onChange={(event) => {
              setVersion(event.currentTarget.value);
              setValidation("");
            }}
            error={validation}
            disabled={!!maintenanceBusy || !available}
          />
          <Button
            leftSection={<Download size={15} />}
            onClick={() => void install()}
            loading={maintenanceBusy === "install"}
            disabled={
              !available || (!!maintenanceBusy && maintenanceBusy !== "install")
            }
          >
            {t("Install version")}
          </Button>
          <Button
            variant="default"
            onClick={async () => {
              const result = await run(
                "rollback",
                api.rollbackCore,
                t("Core rollback completed"),
              );
              if (pageActive.current && result)
                setOutput("Core rollback completed");
            }}
            loading={maintenanceBusy === "rollback"}
            disabled={
              !available ||
              rollbackAvailable === false ||
              (!!maintenanceBusy && maintenanceBusy !== "rollback")
            }
          >
            {t("Roll back")}
          </Button>
        </div>
        {rollbackAvailable === false && (
          <Text c="dimmed" size="xs" mt="sm">
            {t("No previous managed core is available")}
          </Text>
        )}
        {available && (
          <Group gap="xs" mt="xs">
            <Button
              variant="subtle"
              size="xs"
              onClick={() => void run("open-install-logs", api.openInstallLogs)}
            >
              {t("Open installation log folder")}
            </Button>
            <Button
              variant="subtle"
              size="xs"
              onClick={() =>
                void run("open-core-releases", () => api.openSetupHelp("core"))
              }
            >
              {t("View official Core releases")}
            </Button>
          </Group>
        )}
        <Text c="dimmed" size="xs" mt="md">
          {t(
            "First setup needs internet to download the Core and, if needed, Python.",
          )}
        </Text>
        <Text c="dimmed" size="xs" mt={5}>
          {t(
            "Changes apply to the next start. Running services are not restarted.",
          )}
        </Text>
        {output && (
          <Alert color="blue" mt="md" className="break-word">
            {t(output)}
          </Alert>
        )}
        {available && (
          <Button mt="md" onClick={onContinue} disabled={anyBusy}>
            {t(workspace ? "Back to workspace" : "Create your first workspace")}
          </Button>
        )}
        <Divider my="lg" />
        <Group justify="space-between">
          <Group gap="sm">
            <Cloud size={18} />
            <Text size="sm">{t("Cloudflare connector")}</Text>
          </Group>
          <Badge color={cloudflaredAvailable ? "teal" : "gray"} variant="light">
            {t(
              cloudflaredAvailable === null
                ? "Unknown"
                : cloudflaredAvailable
                  ? "Installed"
                  : "Missing",
            )}
          </Badge>
        </Group>
        {available && cloudflaredAvailable === false && (
          <Button
            variant="subtle"
            size="xs"
            onClick={() =>
              void run("open-cloudflare-help", () =>
                api.openSetupHelp("cloudflare"),
              )
            }
          >
            {t("Cloudflare installation instructions")}
          </Button>
        )}
      </Paper>
      {workspace && (
        <RuntimeOverride
          key={workspace.id}
          workspace={workspace}
          status={status}
          onSaved={onSaved}
          run={runWorkspace}
          busy={runtimeBusy}
          t={t}
        />
      )}
      <Group justify="end">
        <Button
          color="red"
          variant="subtle"
          onClick={onQuit}
          disabled={anyBusy || !available}
        >
          {t("Quit application")}
        </Button>
      </Group>
    </Stack>
  );
}

type RuntimeDraft = { executable: string; argumentsText: string };
const sameRuntime = (a: RuntimeDraft, b: RuntimeDraft) =>
  a.executable === b.executable && a.argumentsText === b.argumentsText;

function RuntimeOverride({
  workspace,
  status,
  onSaved,
  run,
  busy,
  t,
}: {
  workspace: Workspace;
  status?: Status;
  onSaved: (workspace: Workspace) => void;
  run: RunAction;
  busy: string;
  t: Translate;
}) {
  const pageActive = usePageActive();
  const [draft, setDraft] = useSavedDraft(
    {
      executable: workspace.coreCommand[0] ?? "",
      argumentsText: workspace.coreCommand.slice(1).join("\n"),
    },
    sameRuntime,
  );
  const { executable, argumentsText } = draft;
  const active = isActive(status);
  const dirty =
    executable.trim() !== (workspace.coreCommand[0] ?? "") ||
    argumentsText !== workspace.coreCommand.slice(1).join("\n");
  async function save() {
    const command = executable.trim()
      ? [
          executable.trim(),
          ...argumentsText.split("\n").filter((value) => value.length > 0),
        ]
      : [];
    const submitted = draft;
    await run(
      "save-runtime",
      async () => {
        await api.validateCoreOverride(workspace.path, command);
        const saved = await api.saveWorkspace({
          ...workspace,
          coreCommand: command,
        });
        // Persisted state belongs to the parent, regardless of this editor's lifecycle.
        // Commit it before the best-effort refresh, which may fail or finish much later.
        onSaved(saved);
        if (pageActive.current)
          setDraft((current) =>
            sameRuntime(current, submitted)
              ? {
                  executable: saved.coreCommand[0] ?? "",
                  argumentsText: saved.coreCommand.slice(1).join("\n"),
                }
              : current,
          );
        return saved;
      },
      t("Saved"),
    );
  }
  return (
    <Paper withBorder p="xl">
      <Title order={3} size="h4">
        {t("Existing core executable")}
      </Title>
      <Text size="sm" c="dimmed" mt="xs" mb="lg">
        {t(
          "Select an already installed official core for this workspace. Leave the executable empty to use the managed core. Arguments are passed directly, without a shell.",
        )}
      </Text>
      {active && (
        <Alert color="yellow" mb="md">
          {t("Stop this workspace before changing its configuration.")}
        </Alert>
      )}
      <Stack gap="md">
        <TextInput
          label={t("Executable path")}
          placeholder={t("Choose or enter an executable path")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={executable}
          onChange={(event) =>
            setDraft({ ...draft, executable: event.currentTarget.value })
          }
          disabled={active || !!busy}
          rightSectionWidth={100}
          rightSection={
            <Button
              size="compact-xs"
              variant="light"
              disabled={active || !!busy}
              onClick={() =>
                void run("browse-core", async () => {
                  const path = await api.pickCoreExecutable();
                  if (path && pageActive.current)
                    setDraft((current) => ({ ...current, executable: path }));
                })
              }
            >
              {t("Browse")}
            </Button>
          }
        />
        <Textarea
          label={t("Arguments (one per line)")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={argumentsText}
          onChange={(event) =>
            setDraft({ ...draft, argumentsText: event.currentTarget.value })
          }
          disabled={active || !!busy || !executable.trim()}
          minRows={2}
        />
        <Group justify="end">
          <Button
            variant="light"
            loading={busy === "save-runtime"}
            disabled={active || (!!busy && busy !== "save-runtime") || !dirty}
            onClick={() => void save()}
          >
            {t("Save runtime selection")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
