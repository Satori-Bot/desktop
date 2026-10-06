import { useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Folder,
  Globe2,
  Laptop,
  ShieldCheck,
} from "lucide-react";
import { api, backendAvailable } from "../api";
import { blankWorkspace, errorText } from "../types";
import type { Access, Secrets, Workspace } from "../types";
import type { Translate } from "../i18n";
import { usePageActive } from "../hooks/usePageActive";
import { SecretInput } from "./SecretInput";
function validate(workspace: Workspace, t: Translate) {
  if (!workspace.name.trim() || !workspace.path.trim())
    return t("Name and folder are required.");
  if (workspace.access !== "local" && workspace.auth === "noauth")
    return t("Remote access requires authentication.");
  if (
    workspace.auth === "oauth" &&
    (workspace.access === "quick" ||
      !/^https:\/\/[^/]+/.test(workspace.publicUrl))
  )
    return t("OAuth requires a stable HTTPS URL.");
  if (workspace.access === "quick" && workspace.auth !== "bearer")
    return t("Quick Tunnel supports bearer authentication only.");
  return null;
}
export function WorkspaceModal({
  workspace,
  onClose,
  onSaved,
  t,
  locked = false,
}: {
  workspace: Workspace | null;
  onClose: () => void;
  onSaved: (workspace: Workspace) => void;
  t: Translate;
  locked?: boolean;
}) {
  const pageActive = usePageActive();
  const [draft, setDraft] = useState<Workspace>(() =>
    workspace ? { ...workspace } : blankWorkspace(),
  );
  const [secrets, setSecrets] = useState<Secrets>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const edit = !!workspace;
  const update = (patch: Partial<Workspace>) =>
    setDraft((d) => ({ ...d, ...patch }));
  async function browse() {
    if (!pageActive.current || lock.current || locked) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const path = await api.pickDirectory();
      if (pageActive.current && path)
        setDraft((d) => ({
          ...d,
          path,
          name: d.name || path.split(/[\\/]/).filter(Boolean).at(-1) || "",
        }));
    } catch (e) {
      if (pageActive.current) setError(errorText(e));
    } finally {
      lock.current = false;
      if (pageActive.current) setBusy(false);
    }
  }
  async function save(start: boolean) {
    if (!pageActive.current || lock.current || locked) return;
    const invalid = validate(draft, t);
    if (invalid) {
      setError(invalid);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveWorkspace(
        { ...draft, name: draft.name.trim(), path: draft.path.trim() },
        secrets,
      );
      if (!pageActive.current) return;
      setDraft(saved);
      onSaved(saved);
      if (start) {
        try {
          await api.start(saved.id);
        } catch (e) {
          if (!pageActive.current) return;
          setError(
            `${t("Created successfully. Start failed; your workspace is saved and can be retried.")} ${errorText(e)}`,
          );
          setStep(3);
          return;
        }
      }
      if (pageActive.current) onClose();
    } catch (e) {
      if (pageActive.current) setError(errorText(e));
    } finally {
      if (pageActive.current) setBusy(false);
      lock.current = false;
    }
  }
  function next() {
    if (step === 0 && (!draft.name.trim() || !draft.path.trim())) {
      setError(t("Name and folder are required."));
      return;
    }
    const invalid = step === 1 ? validate(draft, t) : null;
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setStep((s) => s + 1);
  }
  function access(value: string) {
    const mode = value as Access;
    update({
      access: mode,
      auth:
        mode === "local"
          ? "noauth"
          : mode === "quick"
            ? "bearer"
            : draft.auth === "noauth"
              ? "bearer"
              : draft.auth,
    });
  }
  const folder = (
    <Stack gap="md">
      <TextInput
        label={t("Workspace name")}
        placeholder="my-project"
        value={draft.name}
        onChange={(e) => update({ name: e.currentTarget.value })}
        disabled={busy || locked}
        required
      />
      <TextInput
        label={t("Folder path")}
        placeholder="/Users/you/projects/my-project"
        value={draft.path}
        onChange={(e) => update({ path: e.currentTarget.value })}
        disabled={busy || locked}
        required
        rightSectionWidth={92}
        rightSection={
          <Button
            size="compact-sm"
            variant="light"
            onClick={browse}
            disabled={busy || locked || !backendAvailable()}
            leftSection={<Folder size={14} />}
          >
            {t("Browse")}
          </Button>
        }
      />
      <Text size="xs" c="dimmed">
        {t("Choose the code folder your MCP tools can access.")}
      </Text>
    </Stack>
  );
  const options = (
    <Stack gap="md">
      <Select
        label={t("Access")}
        value={draft.access}
        onChange={(v) => v && access(v)}
        disabled={busy || locked}
        allowDeselect={false}
        data={[
          { value: "local", label: t("Only this device") },
          { value: "quick", label: t("Temporary sharing") },
          { value: "named", label: t("Stable public access") },
          { value: "frp", label: t("FRP / existing HTTPS proxy") },
        ]}
      />
      {draft.access === "local" ? (
        <Alert icon={<ShieldCheck size={18} />} color="teal">
          {t("You can add secure public access later in Connections.")}
        </Alert>
      ) : (
        <>
          <Alert
            icon={<Globe2 size={18} />}
            color={draft.access === "quick" ? "yellow" : "blue"}
          >
            {t(
              draft.access === "quick"
                ? "This URL changes after a restart. Use a named tunnel for a stable address and browser authentication."
                : draft.access === "frp"
                  ? "Configure and run your external proxy separately. Desktop verifies the public endpoint."
                  : "Use an existing tunnel token, or save this workspace and authorize Cloudflare below.",
            )}
          </Alert>
          <Select
            label={t("Authentication")}
            value={draft.auth}
            onChange={(v) => v && update({ auth: v as Workspace["auth"] })}
            disabled={busy || locked}
            allowDeselect={false}
            data={[
              { value: "bearer", label: t("Bearer token") },
              ...(draft.access === "quick"
                ? []
                : [{ value: "oauth", label: t("Browser sign-in (OAuth)") }]),
            ]}
          />
          {draft.access !== "quick" && (
            <TextInput
              label={t("Public HTTPS URL")}
              placeholder="https://mcp.example.com"
              value={draft.publicUrl}
              onChange={(e) => update({ publicUrl: e.currentTarget.value })}
              disabled={busy || locked}
            />
          )}
        </>
      )}
      {draft.auth === "bearer" && (
        <SecretInput
          t={t}
          label={t("Bearer token")}
          description={t(
            edit
              ? "Leave empty to keep the saved secret"
              : "Leave empty to generate a secure credential",
          )}
          value={secrets.bearerToken ?? ""}
          onChange={(e) =>
            setSecrets({ ...secrets, bearerToken: e.currentTarget.value })
          }
          disabled={busy || locked}
          autoComplete="new-password"
        />
      )}
      {draft.auth === "oauth" && (
        <SecretInput
          t={t}
          label={t("OAuth password")}
          description={t(
            edit
              ? "Leave empty to keep the saved secret"
              : "Leave empty to generate a secure credential",
          )}
          value={secrets.oauthPassword ?? ""}
          onChange={(e) =>
            setSecrets({ ...secrets, oauthPassword: e.currentTarget.value })
          }
          disabled={busy || locked}
          autoComplete="new-password"
        />
      )}
      {draft.access === "named" && (
        <>
          <SecretInput
            t={t}
            label={t("Cloudflare tunnel token")}
            description={t("Leave empty to keep the saved secret")}
            value={secrets.cloudflareToken ?? ""}
            onChange={(e) =>
              setSecrets({ ...secrets, cloudflareToken: e.currentTarget.value })
            }
            disabled={busy || locked}
            autoComplete="new-password"
          />
          {edit && (
            <>
              <TextInput
                label={t("Tunnel name")}
                value={draft.tunnelName}
                onChange={(e) => update({ tunnelName: e.currentTarget.value })}
                disabled={busy || locked}
              />
              <TextInput
                label={t("Credentials file")}
                value={draft.credentialsFile}
                onChange={(e) =>
                  update({ credentialsFile: e.currentTarget.value })
                }
                disabled={busy || locked}
              />
            </>
          )}
        </>
      )}
      <Divider />
      <div>
        <Text size="sm" fw={600} mb={8}>
          {t("Permission mode")}
        </Text>
        <SegmentedControl
          fullWidth
          value={draft.permissionMode}
          onChange={(v) =>
            update({ permissionMode: v as Workspace["permissionMode"] })
          }
          disabled={busy || locked}
          data={[
            { value: "safe", label: t("Safe") },
            { value: "trusted", label: t("Trusted") },
          ]}
        />
        <Text size="xs" c="dimmed" mt="xs">
          {t(
            "Safe mode allows file edits with stricter execution checks. Only enable trusted mode for code you trust.",
          )}
        </Text>
      </div>
      {edit && (
        <NumberInput
          label={t("Port")}
          description={t("0 selects an available port")}
          min={0}
          max={65535}
          allowDecimal={false}
          value={draft.port}
          onChange={(v) => update({ port: Number(v) || 0 })}
          disabled={busy || locked}
        />
      )}
    </Stack>
  );
  return (
    <Modal
      opened
      onClose={onClose}
      title={t(edit ? "Edit workspace" : "New workspace")}
      size="lg"
      centered
      closeButtonProps={{ "aria-label": t("Close") }}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      <Stack gap="lg">
        {locked && (
          <Alert color="yellow">
            {t("Stop this workspace before changing its configuration.")}
          </Alert>
        )}
        {!backendAvailable() && (
          <Alert color="orange" title={t("Desktop backend unavailable")}>
            {t(
              "Browser preview only. No services are running here. Open the desktop app to create and manage real workspaces.",
            )}
          </Alert>
        )}
        {!edit && step < 3 && (
          <Stepper active={step} size="xs" allowNextStepsSelect={false}>
            <Stepper.Step
              label={t("Choose folder")}
              icon={<Folder size={15} />}
            />
            <Stepper.Step label={t("Access")} icon={<Laptop size={15} />} />
            <Stepper.Step
              label={t("Review workspace")}
              icon={<Check size={15} />}
            />
          </Stepper>
        )}
        {error && (
          <Alert color="red" icon={<AlertCircle size={17} />} role="alert">
            {error}
          </Alert>
        )}
        {edit ? (
          <>
            {folder}
            {options}
          </>
        ) : step === 0 ? (
          <>
            <div>
              <Title order={3}>
                {t("Create a safe place for your tools.")}
              </Title>
            </div>
            {folder}
          </>
        ) : step === 1 ? (
          <>
            <Title order={3}>
              {t("Start local. Share when you are ready.")}
            </Title>
            {options}
          </>
        ) : step === 2 ? (
          <>
            <Title order={3}>{t("Your workspace is ready to create.")}</Title>
            <div className="review-box">
              <Text fw={650} size="lg">
                {draft.name}
              </Text>
              <Text size="sm" c="dimmed" className="mono break-word" mt={5}>
                {draft.path}
              </Text>
              <Group mt="md">
                <Badge variant="light">
                  {t(
                    draft.access === "local"
                      ? "Local only"
                      : draft.access === "quick"
                        ? "Temporary Quick Tunnel"
                        : draft.access === "named"
                          ? "Stable Cloudflare tunnel"
                          : "Managed by external proxy",
                  )}
                </Badge>
                <Badge variant="light" color="gray">
                  {t(draft.permissionMode === "safe" ? "Safe" : "Trusted")}
                </Badge>
              </Group>
            </div>
            <Text size="xs" c="dimmed">
              {t(
                "Secrets stay in your local desktop configuration. Never paste them into issue reports.",
              )}
            </Text>
          </>
        ) : (
          <Text>{t("Workspace created")}</Text>
        )}
        <Divider />
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            onClick={onClose}
            disabled={busy}
          >
            {t(step === 3 ? "Done" : "Cancel")}
          </Button>
          <Group>
            {!edit && step > 0 && step < 3 && (
              <Button
                variant="default"
                onClick={() => {
                  setStep(step - 1);
                  setError("");
                }}
                disabled={busy || locked}
              >
                {t("Back")}
              </Button>
            )}
            {edit ? (
              <Button
                onClick={() => save(false)}
                loading={busy}
                disabled={locked || !backendAvailable()}
              >
                {t("Save changes")}
              </Button>
            ) : step < 2 ? (
              <Button
                onClick={next}
                rightSection={<ArrowRight size={15} />}
                disabled={busy || locked}
              >
                {t("Continue")}
              </Button>
            ) : step === 2 ? (
              <>
                <Button
                  variant="default"
                  disabled={busy || locked || !backendAvailable()}
                  onClick={() => save(false)}
                >
                  {t("Create workspace")}
                </Button>
                <Button
                  loading={busy}
                  disabled={locked || !backendAvailable()}
                  onClick={() => save(true)}
                >
                  {t("Create and start")}
                </Button>
              </>
            ) : null}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
export function ConfirmModal({
  title,
  detail,
  label,
  onConfirm,
  onClose,
  busy,
  t,
}: {
  title: string;
  detail: string;
  label: string;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
  t: Translate;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      opened
      title={title}
      closeButtonProps={{ "aria-label": t("Close") }}
      onClose={onClose}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
      centered
    >
      <Stack>
        <Text size="sm">{detail}</Text>
        <Checkbox
          label={title}
          checked={checked}
          onChange={(e) => setChecked(e.currentTarget.checked)}
          disabled={busy}
        />
        <Group justify="end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button
            color="red"
            onClick={onConfirm}
            loading={busy}
            disabled={!checked}
          >
            {label}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
