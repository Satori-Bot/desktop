import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import {
  Activity as ActivityIcon,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Command,
  Cpu,
  FolderOpen,
  Globe2,
  HardDrive,
  LayoutDashboard,
  Menu,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Timer,
  Wrench,
  X,
} from "lucide-react";
import { api, backendAvailable } from "./api";
import type { Activity, Snapshot, Workspace } from "./types";
import { errorText, isActive } from "./types";
import { translator } from "./i18n";
import {
  CallList,
  EndpointCard,
  formatDuration,
  formatTime,
  StateBadge,
} from "./components/Common";
import { ConfirmModal, WorkspaceModal } from "./components/WorkspaceModal";
import {
  ActivityPage,
  ConnectionsPage,
  DiagnosticsPage,
  SettingsPage,
} from "./components/Pages";
export type RunAction = <T>(
  key: string,
  fn: () => Promise<T>,
  success?: string,
) => Promise<T | undefined>;
type Confirmation =
  { kind: "delete"; id: string; name: string } | { kind: "quit" };
type Page =
  "Dashboard" | "Connections" | "Activity" | "Diagnostics" | "Settings";
const navigation = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Connections", icon: Globe2 },
  { name: "Activity", icon: ActivityIcon },
  { name: "Diagnostics", icon: Wrench },
  { name: "Settings", icon: Settings2 },
] as const;
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState<Page>("Dashboard");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const request = useRef(0);
  const snapshotFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const [workspaceModal, setWorkspaceModal] = useState<
    Workspace | null | undefined
  >(undefined);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [calls, setCalls] = useState<Activity[]>([]);
  const [activityError, setActivityError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const available = backendAvailable();
  const t = translator(snapshot?.settings.language ?? "en");
  const workspace = snapshot?.workspaces.find((w) => w.id === selected);
  const status = snapshot?.statuses.find((s) => s.workspaceId === selected);
  const active = isActive(status);
  const transitional =
    status?.state === "starting" || status?.state === "stopping";
  const refresh = useCallback((afterMutation = false): Promise<void> => {
    // Polling joins an outstanding read rather than continually invalidating a slow response.
    // A completed mutation may explicitly supersede an older read with a fresh snapshot.
    if (snapshotFlight.current && !afterMutation) return snapshotFlight.current;
    const sequence = ++request.current;
    const flight = (async () => {
      try {
        const next = await api.snapshot();
        if (!mounted.current || sequence !== request.current) return;
        setSnapshot(next);
        setSelected((id) =>
          next.workspaces.some((w) => w.id === id)
            ? id
            : (next.workspaces[0]?.id ?? ""),
        );
        setLoadError("");
      } catch (e) {
        if (mounted.current && sequence === request.current)
          setLoadError(errorText(e));
      } finally {
        if (mounted.current && sequence === request.current) setLoading(false);
      }
    })();
    snapshotFlight.current = flight;
    void flight.then(() => {
      if (snapshotFlight.current === flight) snapshotFlight.current = null;
    });
    return flight;
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (available) {
      void refresh();
      const timer = window.setInterval(() => void refresh(), 4000);
      return () => {
        mounted.current = false;
        window.clearInterval(timer);
      };
    }
    setLoading(false);
    return () => {
      mounted.current = false;
    };
  }, [available, refresh]);
  useEffect(() => {
    document.documentElement.lang =
      snapshot?.settings.language === "zh" ? "zh-CN" : "en";
  }, [snapshot?.settings.language]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let cancelled = false;
    let activityPending = false;
    setCalls([]);
    setActivityError("");
    if (!selected || !available) return;
    const update = async () => {
      if (activityPending) return;
      activityPending = true;
      try {
        const next = await api.activity(selected);
        if (!cancelled) {
          setCalls(next);
          setActivityError("");
        }
      } catch (e) {
        if (!cancelled) setActivityError(errorText(e));
      } finally {
        activityPending = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 3500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected, available, status?.pid]);
  const run: RunAction = async (key, fn, success) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    setError("");
    try {
      const result = await fn();
      if (mounted.current) {
        if (success) setNotice(success);
        await refresh(true);
      }
      return result;
    } catch (e) {
      if (mounted.current) setError(errorText(e));
      return undefined;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy("");
    }
  };
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(t("Copied"));
    } catch (e) {
      setError(`${t("Copy failed")}: ${errorText(e)}`);
    }
  }
  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
    setError("");
  }
  function saved(next: Workspace, navigate = true) {
    ++request.current;
    setSnapshot((current) =>
      current
        ? {
            ...current,
            workspaces: current.workspaces.some((w) => w.id === next.id)
              ? current.workspaces.map((w) => (w.id === next.id ? next : w))
              : [...current.workspaces, next],
          }
        : current,
    );
    setSelected(next.id);
    if (navigate) setPage("Dashboard");
  }
  const closeEditor = () => {
    setWorkspaceModal(undefined);
    void refresh(true);
  };
  async function confirmed() {
    if (confirm?.kind === "delete") {
      const target = snapshot?.workspaces.find(
        (item) => item.id === confirm.id,
      );
      if (!target) {
        setConfirm(null);
        setError(
          t("That workspace is no longer available. Nothing was removed."),
        );
        return;
      }
      if (
        isActive(
          snapshot?.statuses.find((item) => item.workspaceId === target.id),
        )
      ) {
        setConfirm(null);
        setError(t("Stop this workspace before removing it."));
        return;
      }
      const result = await run(
        "delete",
        async () => {
          await api.deleteWorkspace(target.id);
          return true;
        },
        t("Operation completed"),
      );
      if (result) setConfirm(null);
    } else if (confirm?.kind === "quit") {
      await run("quit", api.quit);
    }
  }
  return (
    <div className="desktop-shell">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Command size={23} strokeWidth={2.3} />
          </div>
          <div>
            <strong>Coding Tools</strong>
            <span>MCP DESKTOP</span>
          </div>
          <ActionIcon
            className="mobile-close"
            variant="subtle"
            color="gray"
            aria-label={t("Close")}
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </ActionIcon>
        </div>
        <div className="workspace-switch">
          <span className="nav-eyebrow">{t("WORKSPACE")}</span>
          <Select
            aria-label={t("Choose workspace")}
            placeholder={t("No workspaces yet")}
            value={selected || null}
            onChange={(id) => id && setSelected(id)}
            data={
              snapshot?.workspaces.map((w) => ({
                value: w.id,
                label: w.name,
              })) ?? []
            }
            disabled={!snapshot?.workspaces.length || !!busy}
            leftSection={<FolderOpen size={15} />}
            allowDeselect={false}
          />
          <button
            className="add-workspace"
            onClick={() => setWorkspaceModal(null)}
            disabled={!!busy}
          >
            <Plus size={15} />
            {t("New workspace")}
          </button>
        </div>
        <div className="nav-eyebrow navigation-caption">
          {t("CONTROL ROOM")}
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${page === item.name ? "active" : ""}`}
              onClick={() => navigate(item.name)}
            >
              <item.icon size={18} />
              <span>{t(item.name)}</span>
              {page === item.name && <span className="nav-active-dot" />}
              {item.name === "Connections" &&
                status?.publicState === "error" && (
                  <span className="nav-warning-dot" />
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-mini">
            <span
              className={`runtime-indicator ${snapshot?.coreAvailable ? "installed" : ""}`}
            />
            <div>
              <strong>coding-tools-mcp</strong>
              <span>
                {t(
                  !available
                    ? "Desktop backend unavailable"
                    : !snapshot
                      ? "Unknown"
                      : snapshot.coreAvailable
                        ? "Installed"
                        : "Missing",
                )}
              </span>
            </div>
            <Terminal size={17} />
          </div>
          <div className="sidebar-footer">
            <ShieldCheck size={14} />
            <span>{t("Your code. Your machine.")}</span>
          </div>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label={t("Close")}
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <Group gap="sm">
            <ActionIcon
              className="mobile-menu"
              variant="subtle"
              color="gray"
              onClick={() => setMenuOpen(true)}
              aria-label={t("Open navigation")}
            >
              <Menu size={22} />
            </ActionIcon>
            <span className="breadcrumb-root">Coding Tools</span>
            <span className="breadcrumb-slash">/</span>
            <span>{t(page)}</span>
          </Group>
          <Group gap="md">
            <span className="local-first">
              <span className="status-dot teal" />
              {t("Local-first. Ready for your tools.")}
            </span>
            <Tooltip label={t(colorScheme === "dark" ? "Light" : "Dark")}>
              <ActionIcon
                variant="default"
                size={32}
                onClick={toggleColorScheme}
                aria-label={t(colorScheme === "dark" ? "Light" : "Dark")}
              >
                {colorScheme === "dark" ? (
                  <Sun size={17} />
                ) : (
                  <Moon size={17} />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        </header>
        <main className="content">
          {!available && (
            <Alert
              mb="lg"
              color="orange"
              icon={<CircleAlert size={18} />}
              title={t("Desktop backend unavailable")}
              role="alert"
            >
              {t(
                "Browser preview only. No services are running here. Open the desktop app to create and manage real workspaces.",
              )}
            </Alert>
          )}
          {loadError && available && (
            <Alert
              mb="lg"
              color="red"
              title={t(
                snapshot
                  ? "Unable to refresh status"
                  : "Could not load workspaces",
              )}
              role="alert"
            >
              {loadError}
              <Button
                ml="sm"
                size="xs"
                color="red"
                variant="light"
                onClick={() => void refresh()}
              >
                {t("Retry")}
              </Button>
            </Alert>
          )}
          {error && (
            <Alert
              mb="lg"
              color="red"
              icon={<CircleAlert size={17} />}
              withCloseButton
              onClose={() => setError("")}
              role="alert"
            >
              {error}
            </Alert>
          )}
          {notice && (
            <Alert
              className="notice"
              mb="lg"
              color="teal"
              icon={<Check size={17} />}
              withCloseButton
              onClose={() => setNotice("")}
              role="status"
            >
              {notice}
            </Alert>
          )}
          {snapshot?.migrationNotice && (
            <Alert mb="lg" color="blue">
              {snapshot.migrationNotice}
            </Alert>
          )}
          {loading ? (
            <div className="loading-screen">
              <Loader color="teal" />
              <Text c="dimmed">{t("Loading your workspaces…")}</Text>
            </div>
          ) : page === "Settings" ? (
            <SettingsPage
              settings={
                snapshot?.settings ?? { language: "en", closeToTray: true }
              }
              available={available && !!snapshot}
              coreAvailable={snapshot?.coreAvailable ?? null}
              cloudflaredAvailable={snapshot?.cloudflaredAvailable ?? null}
              run={run}
              busy={busy}
              onQuit={() => setConfirm({ kind: "quit" })}
              workspace={workspace}
              status={status}
              onSaved={(w) => saved(w, false)}
              t={t}
            />
          ) : !workspace ? (
            <>
              <div className="welcome-eyebrow">
                <span className="status-dot teal" />
                {t("Getting started")}
              </div>
              <div className="welcome-title">
                <h1>{t("Connect your code to your AI tools.")}</h1>
                <Text c="dimmed" size="lg" maw={580} lh={1.65}>
                  {t(
                    "Choose a folder, start a local service, and connect your favorite MCP client. Your files stay on your machine.",
                  )}
                </Text>
                <Button
                  mt="xl"
                  size="md"
                  leftSection={<Plus size={18} />}
                  rightSection={<ArrowRight size={17} />}
                  onClick={() => setWorkspaceModal(null)}
                >
                  {t("Create your first workspace")}
                </Button>
              </div>
              <div className="welcome-steps">
                {[
                  {
                    icon: FolderOpen,
                    title: "1. Choose your code",
                    detail: "No account needed",
                  },
                  {
                    icon: Play,
                    title: "2. Start locally",
                    detail: "Safe mode by default",
                  },
                  {
                    icon: Globe2,
                    title: "3. Connect a client",
                    detail: "Standard MCP protocol",
                  },
                ].map((item, i) => (
                  <Paper
                    key={item.title}
                    p="xl"
                    withBorder
                    className="welcome-step"
                  >
                    <div className="step-number">0{i + 1}</div>
                    <item.icon size={24} />
                    <Text fw={650} mt="xl">
                      {t(item.title)}
                    </Text>
                    <Text c="dimmed" size="sm" mt={7}>
                      {t(item.detail)}
                    </Text>
                  </Paper>
                ))}
              </div>
              <Paper withBorder className="welcome-footnote">
                <ShieldCheck size={23} />
                <div>
                  <Text fw={600}>{t("Built for your workflow")}</Text>
                  <Text size="sm" c="dimmed">
                    {t("Connect locally first, then choose how you share.")}
                  </Text>
                </div>
                <Terminal size={33} />
              </Paper>
            </>
          ) : (
            <>
              <div className="workspace-heading">
                <div>
                  <div className="workspace-kicker">
                    <span className="workspace-symbol">
                      <FolderOpen size={16} />
                    </span>
                    {t("WORKSPACE")}
                    <StateBadge state={status?.state} t={t} />
                  </div>
                  <Title order={1}>{workspace.name}</Title>
                  <button
                    className="folder-path mono"
                    onClick={() =>
                      void run("open", () => api.openWorkspace(workspace.id))
                    }
                    disabled={!!busy}
                  >
                    {workspace.path}
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <Group gap="xs" className="workspace-controls">
                  {active ? (
                    <>
                      <Button
                        variant="default"
                        leftSection={<RefreshCw size={15} />}
                        disabled={!!busy || transitional}
                        onClick={() =>
                          void run("restart", () => api.restart(workspace.id))
                        }
                      >
                        {t("Restart")}
                      </Button>
                      <Button
                        color="red"
                        variant="light"
                        leftSection={<Square size={14} />}
                        loading={busy === "stop"}
                        disabled={(!!busy && busy !== "stop") || transitional}
                        onClick={() =>
                          void run("stop", () => api.stop(workspace.id))
                        }
                      >
                        {t("Stop workspace")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      leftSection={<Play size={16} />}
                      loading={busy === "start"}
                      disabled={(!!busy && busy !== "start") || !available}
                      onClick={() =>
                        void run("start", () => api.start(workspace.id))
                      }
                    >
                      {t("Start workspace")}
                    </Button>
                  )}
                </Group>
              </div>
              {page === "Dashboard" ? (
                <>
                  <div className="metrics-grid">
                    {[
                      {
                        icon: Cpu,
                        label: "CPU usage",
                        value: status
                          ? `${status.cpuPercent.toFixed(1)}%`
                          : "—",
                        detail:
                          status?.state === "running"
                            ? "Running"
                            : "Not running",
                      },
                      {
                        icon: HardDrive,
                        label: "Memory",
                        value: status
                          ? `${(status.memoryBytes / 1024 / 1024).toFixed(1)} MB`
                          : "—",
                        detail: status?.pid
                          ? `PID ${status.pid}`
                          : "Not running",
                      },
                      {
                        icon: Timer,
                        label: "Uptime",
                        value: status
                          ? formatDuration(status.uptimeSeconds)
                          : "—",
                        detail:
                          status?.state === "running"
                            ? "Running"
                            : "Not running",
                      },
                      {
                        icon: Terminal,
                        label: "Core version",
                        value:
                          status?.coreVersion || workspace.coreVersion || "—",
                        detail:
                          workspace.permissionMode === "safe"
                            ? "Safe"
                            : "Trusted",
                      },
                    ].map((metric) => (
                      <Paper
                        withBorder
                        className="metric-card"
                        key={metric.label}
                      >
                        <div className="metric-label">
                          <metric.icon size={16} />
                          {t(metric.label)}
                        </div>
                        <div className="metric-value">{metric.value}</div>
                        <div className="metric-detail">{t(metric.detail)}</div>
                      </Paper>
                    ))}
                  </div>
                  <div className="endpoint-grid">
                    <EndpointCard
                      status={status}
                      access={workspace.access}
                      isPublic={false}
                      t={t}
                      onCopy={copy}
                    />
                    <EndpointCard
                      status={status}
                      access={workspace.access}
                      isPublic
                      t={t}
                      onCopy={copy}
                      onConfigure={() => navigate("Connections")}
                    />
                  </div>
                  {status?.publicState === "error" && (
                    <Alert
                      mt="lg"
                      color="orange"
                      title={t("Public access")}
                      icon={<CircleAlert size={18} />}
                    >
                      {t(
                        ["running", "ready", "online", "ok"].includes(
                          status.localState,
                        )
                          ? "Local service remains available. Fix the tunnel without restarting your tools."
                          : "Local service is not running. Start it before retrying the tunnel.",
                      )}
                      <Button
                        size="xs"
                        variant="light"
                        ml="sm"
                        onClick={() => navigate("Connections")}
                      >
                        {t("Configure access")}
                      </Button>
                    </Alert>
                  )}
                  <Paper withBorder className="activity-panel">
                    <div className="panel-title">
                      <Group gap="xs">
                        <ActivityIcon size={18} />
                        <Text fw={650}>{t("Recent tool calls")}</Text>
                        {calls.length > 0 && (
                          <Badge color="gray" variant="light" size="sm">
                            {calls.length}
                          </Badge>
                        )}
                      </Group>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        rightSection={<ArrowRight size={14} />}
                        onClick={() => navigate("Activity")}
                      >
                        {t("View all")}
                      </Button>
                    </div>
                    {status?.activityState === "unavailable" && (
                      <Alert
                        color="yellow"
                        m="md"
                        title={t("Tool history unavailable")}
                      >
                        {t(
                          "This core build does not expose tool-call history. Install an event-capable official core and select its executable in Settings. No calls are fabricated.",
                        )}
                      </Alert>
                    )}
                    {activityError ? (
                      <Alert
                        color="red"
                        m="md"
                        title={t("Could not load activity")}
                      >
                        {activityError}
                      </Alert>
                    ) : (
                      <CallList
                        unavailable={status?.activityState === "unavailable"}
                        calls={calls}
                        t={t}
                        language={snapshot?.settings.language ?? "en"}
                        limit={5}
                      />
                    )}
                  </Paper>
                  <div className="dashboard-bottom">
                    <ShieldCheck size={17} />
                    <Text size="sm" c="dimmed">
                      {t(
                        "Use the local endpoint or copy the client configuration. Public access is optional.",
                      )}
                    </Text>
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => navigate("Connections")}
                    >
                      {t("Connect a client")}
                      <ArrowRight size={13} />
                    </Button>
                  </div>
                </>
              ) : page === "Connections" ? (
                <ConnectionsPage
                  key={workspace.id}
                  workspace={workspace}
                  status={status}
                  run={run}
                  busy={busy}
                  t={t}
                  onEdit={() => setWorkspaceModal(workspace)}
                  onRemove={() =>
                    setConfirm({
                      kind: "delete",
                      id: workspace.id,
                      name: workspace.name,
                    })
                  }
                  onCopy={copy}
                  onSaved={(w) => saved(w, false)}
                />
              ) : page === "Activity" ? (
                <ActivityPage
                  calls={calls}
                  error={activityError}
                  status={status}
                  language={snapshot?.settings.language ?? "en"}
                  t={t}
                />
              ) : page === "Diagnostics" ? (
                <DiagnosticsPage
                  key={workspace.id}
                  workspace={workspace}
                  run={run}
                  busy={busy}
                  t={t}
                />
              ) : null}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>
            Coding Tools MCP <span className="footer-dot">·</span> Desktop
          </span>
          <span>
            {available
              ? status?.checkedAt
                ? `${t("Last checked")} ${formatTime(status.checkedAt, snapshot?.settings.language)}`
                : "Tauri + Rust"
              : "BROWSER PREVIEW"}
            <span className="footer-dot">·</span>
            {t("Your code. Your machine.")}
          </span>
        </footer>
      </div>
      {workspaceModal !== undefined && (
        <WorkspaceModal
          workspace={workspaceModal}
          locked={
            !!workspaceModal &&
            isActive(
              snapshot?.statuses.find(
                (s) => s.workspaceId === workspaceModal.id,
              ),
            )
          }
          onClose={closeEditor}
          onSaved={saved}
          t={t}
        />
      )}{" "}
      {confirm && (
        <ConfirmModal
          title={t(
            confirm.kind === "delete"
              ? "Remove this workspace?"
              : "Quit and stop services?",
          )}
          detail={`${confirm.kind === "delete" ? `${confirm.name}\n` : ""}${t(
            confirm.kind === "delete"
              ? "This removes the saved configuration. Your source files are never deleted. Backups and logs are retained."
              : "All running workspaces will be stopped.",
          )}`}
          label={t(confirm.kind === "delete" ? "Remove" : "Quit")}
          onConfirm={() => void confirmed()}
          onClose={() => setConfirm(null)}
          busy={!!busy}
          t={t}
        />
      )}
    </div>
  );
}
