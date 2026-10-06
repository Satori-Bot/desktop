import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  Paper,
  PasswordInput,
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
import { errorText, isActive } from "../types";
import type { Translate } from "../i18n";
import type { RunAction } from "../App";
import { CallList, Empty, EndpointCard, SectionHead } from "./Common";
import { ConfirmModal } from "./WorkspaceModal";
export function ConnectionsPage({
  workspace,
  status,
  run,
  busy,
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
  t: Translate;
  onEdit: () => void;
  onRemove: () => void;
  onCopy: (text: string) => Promise<void>;
  onSaved: (w: Workspace) => void;
}) {
  const [config, setConfig] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<AuthDetails | null>(null);
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
  const [loginOutput, setLoginOutput] = useState("");
  const [validation, setValidation] = useState("");
  const active = isActive(status);
  async function showConfig(isPublic: boolean, copyOnly = false) {
    const result = await run(copyOnly ? "copy-config" : "config", () =>
      api.connectionConfig(workspace.id, isPublic),
    );
    if (result !== undefined) {
      if (copyOnly) await onCopy(result);
      else setConfig(result);
    }
  }
  async function showCredentials() {
    const result = await run("credentials", () =>
      api.authDetails(workspace.id),
    );
    if (result) setCredentials(result);
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
    setConfirm(true);
  }
  async function createTunnel() {
    const result = await run(
      "tunnel-setup",
      () => api.setupNamedTunnel(workspace.id, tunnelName, hostname),
      t("Operation completed"),
    );
    if (result) {
      setConfirm(false);
      onSaved(result);
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
        <div>
          <EndpointCard
            status={status}
            access={workspace.access}
            isPublic={false}
            t={t}
            onCopy={onCopy}
            busy={!!busy}
          />
          <Group mt="sm">
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
        </div>
        <div>
          <EndpointCard
            status={status}
            access={workspace.access}
            isPublic
            t={t}
            onCopy={onCopy}
            busy={!!busy}
          />
          <Group mt="sm">
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
                loading={busy === "retry-tunnel"}
                onClick={() =>
                  void run("retry-tunnel", () => api.retryTunnel(workspace.id))
                }
              >
                {t("Retry tunnel")}
              </Button>
            )}
          </Group>
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
      <Paper withBorder p="lg">
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
          <Button variant="light" onClick={onEdit} disabled={active || !!busy}>
            {t("Configure access")}
          </Button>
        ) : (
          <Stack>
            <Button
              w="fit-content"
              variant="default"
              leftSection={<Globe2 size={16} />}
              disabled={active || !!busy}
              loading={busy === "cloudflare-login"}
              onClick={async () => {
                const output = await run(
                  "cloudflare-login",
                  api.cloudflareLogin,
                );
                if (output) setLoginOutput(output);
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
                disabled={active || !!busy}
              />
              <TextInput
                label={t("Hostname")}
                placeholder="mcp.example.com"
                value={hostname}
                onChange={(e) => setHostname(e.currentTarget.value)}
                disabled={active || !!busy}
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
              disabled={active || !!busy}
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
          <Code block className="config-code">
            {config}
          </Code>
          <Button
            leftSection={<Clipboard size={15} />}
            onClick={() => config && void onCopy(config)}
          >
            {t("Copy config")}
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={credentials !== null}
        onClose={() => setCredentials(null)}
        title={t("Show credentials")}
        centered
      >
        <Stack>
          <Alert color="yellow" icon={<KeyRound size={17} />}>
            {t(
              "Secrets stay in your local desktop configuration. Never paste them into issue reports.",
            )}
          </Alert>
          {credentials?.bearerToken && (
            <PasswordInput
              label={t("Bearer token")}
              value={credentials.bearerToken}
              readOnly
            />
          )}
          {credentials?.oauthPassword && (
            <PasswordInput
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
          busy={!!busy}
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
      (outcome === "all" ||
        (outcome === "pending" && !call.finishedAt) ||
        (outcome === "success" &&
          !!call.finishedAt &&
          ["success", "ok", "completed"].includes(call.outcome)) ||
        (outcome === "failed" &&
          !!call.finishedAt &&
          !["success", "ok", "completed"].includes(call.outcome))),
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
            "This core build does not expose tool-call history. Install an event-capable official core and select its executable in Settings. No calls are fabricated.",
          )}
          {status.activityMessage && (
            <Text size="xs" mt="xs">
              {status.activityMessage}
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
            { value: "pending", label: t("In progress") },
          ]}
        />
      </div>
      {error && (
        <Alert color="red" title={t("Could not load activity")}>
          {error}
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
  run,
  busy,
  t,
}: {
  workspace: Workspace;
  run: RunAction;
  busy: string;
  t: Translate;
}) {
  const [checks, setChecks] = useState<Diagnostic[] | null>(null);
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
      setLogs((current) =>
        `${reset ? "" : current}${result.text}`.slice(-100000),
      );
      cursor.current = result.cursor;
      setTruncated(result.truncated);
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
    cursor.current = 0;
    void readLogs(true);
    return () => {
      ++generation.current;
    };
  }, [kind, workspace.id]);
  async function diagnose() {
    const result = await run("diagnose", () => api.diagnose(workspace.id));
    if (result) setChecks(result);
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
            {checks.map((item, index) => (
              <div key={`${item.name}-${index}`} className="diagnostic-row">
                <div className={`diagnostic-icon ${item.level}`}>
                  {item.level === "ok" ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <AlertCircle size={19} />
                  )}
                </div>
                <div>
                  <Text fw={600} size="sm">
                    {item.name}
                  </Text>
                  <Text size="sm" c="dimmed" className="break-word">
                    {item.message}
                  </Text>
                </div>
                <Badge
                  ml="auto"
                  color={
                    item.level === "ok"
                      ? "teal"
                      : item.level === "error"
                        ? "red"
                        : "yellow"
                  }
                  variant="light"
                >
                  {t(
                    item.level === "ok"
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
            {logError}
          </Alert>
        )}
        {truncated && (
          <Text px="lg" pt="sm" c="dimmed" size="xs">
            {t("Showing the most recent log output.")}
          </Text>
        )}
        <pre className="log-output">{logs || t("No logs available")}</pre>
      </Paper>
    </Stack>
  );
}
export function SettingsPage({
  settings,
  available,
  coreAvailable,
  cloudflaredAvailable,
  run,
  busy,
  onQuit,
  workspace,
  status,
  onSaved,
  t,
}: {
  settings: Settings;
  available: boolean;
  coreAvailable: boolean | null;
  cloudflaredAvailable: boolean | null;
  run: RunAction;
  busy: string;
  onQuit: () => void;
  workspace?: Workspace;
  status?: Status;
  onSaved: (workspace: Workspace) => void;
  t: Translate;
}) {
  const [draft, setDraft] = useState(settings);
  const dirty = useRef(false);
  const [version, setVersion] = useState("");
  const [validation, setValidation] = useState("");
  const [output, setOutput] = useState("");
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    if (!dirty.current) setDraft(settings);
  }, [settings]);
  async function save() {
    const result = await run(
      "settings",
      () => api.saveSettings(draft),
      t("Saved"),
    );
    if (result) {
      setDraft(result);
      dirty.current = false;
    }
  }
  async function install() {
    if (!/^\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.+-]*)$/.test(version)) {
      setValidation(t("Enter an exact version, for example 0.1.0."));
      return;
    }
    setValidation("");
    const result = await run("install", () => api.installCore(version));
    if (result) setOutput(result);
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
                dirty.current = true;
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
              dirty.current = true;
              setDraft({ ...draft, closeToTray: event.currentTarget.checked });
            }}
          />
        </div>
        <Group justify="end" mt="xl">
          <Button
            onClick={() => void save()}
            loading={busy === "settings"}
            disabled={
              !available || (!!busy && busy !== "settings") || !dirty.current
            }
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
            "Published core 0.5.0 supports launch and connections, but does not expose per-tool-call history. History requires an event-capable official core.",
          )}
        </Alert>
        <div className="core-install">
          <TextInput
            label={t("Version to install")}
            placeholder="0.1.0"
            value={version}
            onChange={(event) => setVersion(event.currentTarget.value)}
            error={validation}
            disabled={!!busy || !available}
          />
          <Button
            leftSection={<Download size={15} />}
            onClick={() => void install()}
            loading={busy === "install"}
            disabled={!available || (!!busy && busy !== "install")}
          >
            {t("Install version")}
          </Button>
          <Button
            variant="default"
            onClick={async () => {
              const result = await run("rollback", api.rollbackCore);
              if (result) setOutput(result);
            }}
            loading={busy === "rollback"}
            disabled={!available || (!!busy && busy !== "rollback")}
          >
            {t("Roll back")}
          </Button>
        </div>
        <Text c="dimmed" size="xs" mt="md">
          {t("Install requires uv and network access.")}
        </Text>
        <Text c="dimmed" size="xs" mt={5}>
          {t(
            "Changes apply to the next start. Running services are not restarted.",
          )}
        </Text>
        {output && (
          <Alert color="blue" mt="md" className="break-word">
            {output}
          </Alert>
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
      </Paper>
      {workspace && (
        <RuntimeOverride
          key={workspace.id}
          workspace={workspace}
          status={status}
          onSaved={onSaved}
          run={run}
          busy={busy}
          t={t}
        />
      )}
      <Group justify="end">
        <Button
          color="red"
          variant="subtle"
          onClick={onQuit}
          disabled={!!busy || !available}
        >
          {t("Quit application")}
        </Button>
      </Group>
    </Stack>
  );
}

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
  const [executable, setExecutable] = useState(workspace.coreCommand[0] ?? "");
  const [argumentsText, setArgumentsText] = useState(
    workspace.coreCommand.slice(1).join("\n"),
  );
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
    const result = await run(
      "save-runtime",
      () => api.saveWorkspace({ ...workspace, coreCommand: command }),
      t("Saved"),
    );
    if (result) onSaved(result);
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
          placeholder="/path/to/venv/bin/coding-tools-mcp"
          value={executable}
          onChange={(event) => setExecutable(event.currentTarget.value)}
          disabled={active || !!busy}
        />
        <Textarea
          label={t("Arguments (one per line)")}
          value={argumentsText}
          onChange={(event) => setArgumentsText(event.currentTarget.value)}
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
