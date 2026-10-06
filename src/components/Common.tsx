import { Badge, Button, Group, Paper, Text, Title } from "@mantine/core";
import {
  ArrowUpRight,
  CircleCheck,
  CircleX,
  Clock3,
  FolderPlus,
  Monitor,
  Radio,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Activity, Status } from "../types";
import type { Translate } from "../i18n";
export function StateBadge({ state, t }: { state?: string; t: Translate }) {
  const known: Record<string, [string, string]> = {
    running: ["Running", "teal"],
    connected: ["Connected, unverified", "yellow"],
    unverified: ["Unverified", "yellow"],
    connecting: ["Connecting…", "yellow"],
    unhealthy: ["Unhealthy", "red"],
    ready: ["Ready", "teal"],
    online: ["Online", "teal"],
    ok: ["Ready", "teal"],
    stopped: ["Stopped", "gray"],
    disabled: ["Not configured", "gray"],
    unconfigured: ["Not configured", "gray"],
    starting: ["Starting…", "yellow"],
    stopping: ["Stopping…", "yellow"],
    checking: ["Checking", "yellow"],
    error: ["Error", "red"],
    failed: ["Failed", "red"],
    unavailable: ["Unavailable", "orange"],
    offline: ["Offline", "gray"],
  };
  const [label, color] = known[state ?? ""] ?? ["Unknown", "gray"];
  return (
    <Badge
      color={color}
      variant="light"
      radius="sm"
      leftSection={<span className={`status-dot ${color}`} />}
    >
      {t(label)}
    </Badge>
  );
}
export function Empty({
  icon,
  title,
  detail,
  children,
}: {
  icon?: ReactNode;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <FolderPlus size={25} />}</div>
      <Title order={3} size="h4">
        {title}
      </Title>
      <Text size="sm" c="dimmed" maw={420}>
        {detail}
      </Text>
      {children}
    </div>
  );
}
export function SectionHead({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <Title order={2}>{title}</Title>
        {detail && (
          <Text c="dimmed" size="sm" mt={5}>
            {detail}
          </Text>
        )}
      </div>
      {children}
    </div>
  );
}
export const formatDuration = (seconds: number) =>
  seconds < 60
    ? `${Math.floor(seconds)}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
export const formatTime = (date: string, language = "en") => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleTimeString(language === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};
export function CallList({
  calls,
  t,
  language,
  limit,
  unavailable = false,
}: {
  calls: Activity[];
  t: Translate;
  language: string;
  limit?: number;
  unavailable?: boolean;
}) {
  if (!calls.length)
    return (
      <Empty
        icon={<Radio size={25} />}
        title={t(
          unavailable ? "Tool history unavailable" : "No tool calls yet",
        )}
        detail={t(
          unavailable
            ? "Tool-call history requires a core with event-journal support. You can configure one in Settings."
            : "Connect an MCP client and run a tool. Real calls will appear here automatically.",
        )}
      />
    );
  return (
    <div
      className="call-table"
      role="table"
      aria-label={t("Recent tool calls")}
    >
      <div className="call-row call-header" role="row">
        <span>{t("Tool")}</span>
        <span>{t("Outcome")}</span>
        <span>{t("Duration")}</span>
        <span>{t("Started")}</span>
      </div>
      {calls.slice(0, limit).map((call) => {
        const success = ["success", "ok", "completed"].includes(call.outcome);
        const pending = !call.finishedAt;
        return (
          <div className="call-row" role="row" key={call.id}>
            <div className="tool-name">
              <span
                className={`call-icon ${pending ? "pending" : success ? "success" : "failure"}`}
              >
                {pending ? (
                  <Clock3 size={15} />
                ) : success ? (
                  <CircleCheck size={15} />
                ) : (
                  <CircleX size={15} />
                )}
              </span>
              <div>
                <Text fw={550} size="sm" className="mono">
                  {call.tool}
                </Text>
                {call.errorCategory && (
                  <Text size="xs" c="red">
                    {call.errorCategory}
                  </Text>
                )}
              </div>
            </div>
            <Badge
              color={pending ? "yellow" : success ? "teal" : "red"}
              variant="light"
              size="sm"
            >
              {t(pending ? "In progress" : success ? "Success" : "Failed")}
            </Badge>
            <span className="mono muted">
              {call.durationMs === null
                ? "—"
                : call.durationMs < 1000
                  ? `${call.durationMs} ms`
                  : `${(call.durationMs / 1000).toFixed(2)} s`}
            </span>
            <span className="muted call-time">
              {formatTime(call.startedAt, language)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
export function EndpointCard({
  isPublic,
  status,
  access,
  t,
  onCopy,
  onConfigure,
  busy,
}: {
  isPublic: boolean;
  status?: Status;
  access: string;
  t: Translate;
  onCopy: (value: string) => void;
  onConfigure?: () => void;
  busy?: boolean;
}) {
  const endpoint = isPublic ? status?.publicEndpoint : status?.localEndpoint;
  const state = isPublic ? status?.publicState : status?.localState;
  const message = isPublic ? status?.publicMessage : status?.localMessage;
  return (
    <Paper
      className={`endpoint-card ${isPublic ? "public-card" : "local-card"}`}
      p="lg"
      withBorder
    >
      <Group justify="space-between" align="start">
        <div className="endpoint-icon">
          {isPublic ? <ArrowUpRight size={21} /> : <Monitor size={21} />}
        </div>
        <StateBadge
          state={isPublic && access === "local" ? "disabled" : state}
          t={t}
        />
      </Group>
      <Text fw={650} mt="md">
        {t(isPublic ? "Public access" : "Local service")}
      </Text>
      <Text c="dimmed" size="xs" mt={3}>
        {t(isPublic ? "External clients" : "On this device")}
      </Text>
      {endpoint ? (
        <div className="endpoint-url mono">{endpoint}</div>
      ) : (
        <Text size="sm" c="dimmed" mt="md" className="endpoint-placeholder">
          {t(
            isPublic
              ? "No public endpoint. Your workspace is only accessible on this device."
              : "Start your workspace to connect an MCP client.",
          )}
        </Text>
      )}
      {message && (
        <Text
          size="xs"
          c={state === "error" ? "red" : "dimmed"}
          mt="xs"
          className="break-word"
        >
          {message}
        </Text>
      )}
      <Group mt="lg">
        <Button
          size="xs"
          variant="light"
          disabled={!endpoint || busy}
          onClick={() => endpoint && onCopy(endpoint)}
        >
          {t("Copy endpoint")}
        </Button>
        {isPublic && onConfigure && (
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={onConfigure}
            rightSection={<ArrowUpRight size={13} />}
          >
            {t("Configure access")}
          </Button>
        )}
      </Group>
    </Paper>
  );
}
