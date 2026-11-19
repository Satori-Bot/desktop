import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  Textarea,
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

type WorkspaceField = "name" | "path" | "port" | "core";
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
  workspaceNames,
  onClose,
  onSaved,
  t,
  coreAvailable,
  onInstallCore,
  installBusy = "",
  opened = true,
  locked = false,
}: {
  workspace: Workspace | null;
  workspaceNames: string[];
  onClose: () => void;
  onSaved: (workspace: Workspace) => void;
  t: Translate;
  coreAvailable: boolean;
  onInstallCore: (onError: (message: string) => void) => void | Promise<void>;
  installBusy?: string;
  opened?: boolean;
  locked?: boolean;
}) {
  const pageActive = usePageActive();
  const [draft, setDraft] = useState<Workspace>(() =>
    workspace ? { ...workspace } : blankWorkspace(),
  );
  const [portText, setPortText] = useState(() =>
    draft.port === 0 ? "" : String(draft.port),
  );
  const [showCore, setShowCore] = useState(false);
  const [corePath, setCorePath] = useState("");
  const [coreArgs, setCoreArgs] = useState("");
  const override =
    showCore && corePath.trim()
      ? [
          corePath.trim(),
          ...coreArgs.split("\n").filter((arg) => arg.length > 0),
        ]
      : draft.coreCommand;
  const [secrets, setSecrets] = useState<Secrets>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<WorkspaceField>();
  const nameInput = useRef<HTMLInputElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const portInput = useRef<HTMLInputElement>(null);
  const coreInput = useRef<HTMLInputElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const edit = !!workspace;
  const needsCore = !coreAvailable && override.length === 0;
  const update = (patch: Partial<Workspace>) =>
    setDraft((d) => ({ ...d, ...patch }));
  function clearError() {
    setErrorField(undefined);
    setError("");
  }
  function fail(message: string, field?: WorkspaceField) {
    setErrorField(field);
    setError(message);
  }
  function fieldError(field: WorkspaceField) {
    return error && errorField === field ? (
      <span role="alert">{error}</span>
    ) : undefined;
  }
  function clearFieldError(field: WorkspaceField) {
    if (errorField === field) clearError();
  }
  function nameAlreadyUsed() {
    const normalize = (name: string) => name.trim().toLowerCase();
    const name = normalize(draft.name);
    return (
      name !== normalize(workspace?.name ?? "") &&
      workspaceNames.some((other) => normalize(other) === name)
    );
  }
  useEffect(() => {
    if (!opened || busy || !error) return;
    const field = {
      name: nameInput,
      path: pathInput,
      port: portInput,
      core: coreInput,
    };
    (errorField ? field[errorField].current : errorSummary.current)?.focus();
  }, [opened, busy, error, errorField]);
  useEffect(() => {
    if (opened && showCore) coreInput.current?.focus();
  }, [opened, showCore]);
  function goNextWithEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (
      edit ||
      step !== 0 ||
      locked ||
      busy ||
      event.key !== "Enter" ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    void next();
  }
  async function install() {
    if (!pageActive.current || lock.current || locked || installBusy) return;
    lock.current = true;
    setBusy(true);
    clearError();
    try {
      await onInstallCore((message) => {
        if (pageActive.current) fail(t(message));
      });
    } catch (error) {
      if (pageActive.current) fail(t(errorText(error)));
    } finally {
      lock.current = false;
      if (pageActive.current) setBusy(false);
    }
  }
  async function browse() {
    if (!pageActive.current || lock.current || locked) return;
    lock.current = true;
    setBusy(true);
    clearError();
    try {
      const path = await api.pickDirectory();
      if (pageActive.current && path)
        setDraft((d) => ({
          ...d,
          path,
          name: d.name || path.split(/[\\/]/).filter(Boolean).at(-1) || "",
        }));
    } catch (e) {
      if (pageActive.current) fail(t(errorText(e)));
    } finally {
      lock.current = false;
      if (pageActive.current) setBusy(false);
    }
  }
  async function browseCore() {
    if (!pageActive.current || lock.current || locked) return;
    lock.current = true;
    setBusy(true);
    clearError();
    try {
      const path = await api.pickCoreExecutable();
      if (pageActive.current && path) setCorePath(path);
    } catch (e) {
      if (pageActive.current) fail(t(errorText(e)));
    } finally {
      lock.current = false;
      if (pageActive.current) setBusy(false);
    }
  }
  async function save(start: boolean) {
    if (!pageActive.current || lock.current || locked) return;
    if (start && needsCore) return;
    if (nameAlreadyUsed()) {
      fail(
        t("A workspace already has this name; choose a different name"),
        "name",
      );
      return;
    }
    const port = portText.trim() === "" ? 0 : Number(portText);
    if (
      portText.trim() !== "" &&
      (!/^\d+$/.test(portText.trim()) || port < 1 || port > 65535)
    ) {
      fail(
        t(
          "Enter a whole port number from 1 to 65535, or leave blank for automatic.",
        ),
        "port",
      );
      return;
    }
    if (showCore && !corePath.trim() && (start || coreArgs.trim())) {
      fail(t("Enter an existing core executable."), "core");
      return;
    }
    const invalid = validate(draft, t);
    if (invalid) {
      fail(
        invalid,
        edit
          ? !draft.name.trim()
            ? "name"
            : !draft.path.trim()
              ? "path"
              : undefined
          : undefined,
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    clearError();
    try {
      if (showCore && corePath.trim()) {
        try {
          await api.validateCoreOverride(draft.path, override);
        } catch (error) {
          if (pageActive.current) fail(t(errorText(error)), "core");
          return;
        }
      }
      const saved = await api.saveWorkspace(
        {
          ...draft,
          name: draft.name.trim(),
          path: draft.path.trim(),
          port,
          coreCommand: override,
        },
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
          fail(
            `${t("Created successfully. Start failed; your workspace is saved and can be retried.")} ${errorText(e)}`,
          );
          setStep(3);
          return;
        }
      }
      if (pageActive.current) onClose();
    } catch (e) {
      if (pageActive.current) {
        const message = errorText(e);
        const field =
          message ===
          "A workspace already has this name; choose a different name"
            ? "name"
            : message ===
                "Another workspace already uses this port; choose a different port"
              ? "port"
              : message === "Choose an existing workspace folder"
                ? "path"
                : undefined;
        fail(t(message), edit ? field : undefined);
      }
    } finally {
      if (pageActive.current) setBusy(false);
      lock.current = false;
    }
  }
  async function next() {
    if (step === 0) {
      if (!draft.name.trim() || !draft.path.trim()) {
        fail(
          t("Name and folder are required."),
          draft.name.trim() ? "path" : "name",
        );
        return;
      }
      if (nameAlreadyUsed()) {
        fail(
          t("A workspace already has this name; choose a different name"),
          "name",
        );
        return;
      }
      if (backendAvailable()) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          const path = await api.validateWorkspacePath(draft.path.trim());
          if (!pageActive.current) return;
          update({ path });
        } catch (e) {
          if (pageActive.current) fail(t(errorText(e)), "path");
          return;
        } finally {
          lock.current = false;
          if (pageActive.current) setBusy(false);
        }
      }
    }
    const invalid = step === 1 ? validate(draft, t) : null;
    if (invalid) {
      fail(invalid);
      return;
    }
    clearError();
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
        ref={nameInput}
        data-autofocus={!locked || undefined}
        value={draft.name}
        error={fieldError("name")}
        onKeyDown={goNextWithEnter}
        onChange={(e) => {
          update({ name: e.currentTarget.value });
          clearFieldError("name");
        }}
        disabled={busy || locked}
        required
      />
      <TextInput
        label={t("Folder path")}
        placeholder={t("Choose or enter an absolute folder path")}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        ref={pathInput}
        value={draft.path}
        error={fieldError("path")}
        onKeyDown={goNextWithEnter}
        onChange={(e) => {
          update({ path: e.currentTarget.value });
          clearFieldError("path");
        }}
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
              type="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
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
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={draft.tunnelName}
                onChange={(e) => update({ tunnelName: e.currentTarget.value })}
                disabled={busy || locked}
              />
              <TextInput
                label={t("Credentials file")}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
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
        <TextInput
          label={t("Port")}
          placeholder={t("Automatic")}
          description={t("Leave blank to choose an available port.")}
          inputMode="numeric"
          ref={portInput}
          value={portText}
          error={fieldError("port")}
          onChange={(event) => {
            setPortText(event.currentTarget.value);
            clearFieldError("port");
          }}
          disabled={busy || locked}
        />
      )}
    </Stack>
  );
  return (
    <Modal
      opened={opened}
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
        {!edit && (!coreAvailable || showCore) && (
          <Alert
            color="orange"
            title={t("Choose a Core to start this workspace")}
          >
            <Text size="sm" mb="xs">
              {t(
                "First setup needs internet to download the Core and, if needed, Python.",
              )}
            </Text>
            <Group>
              {!coreAvailable && (
                <Button
                  size="xs"
                  onClick={() => void install()}
                  loading={installBusy === "install"}
                  disabled={busy || !!installBusy}
                >
                  {t("Install core")}
                </Button>
              )}
              <Button
                size="xs"
                variant="default"
                aria-expanded={showCore}
                onClick={() => {
                  setShowCore(!showCore);
                  clearError();
                }}
                disabled={busy}
              >
                {t("Use existing Core")}
              </Button>
            </Group>
            {showCore && (
              <Stack mt="sm" gap="xs">
                <TextInput
                  label={t("Existing core executable")}
                  ref={coreInput}
                  value={corePath}
                  error={fieldError("core")}
                  onChange={(event) => {
                    setCorePath(event.currentTarget.value);
                    clearFieldError("core");
                  }}
                  rightSectionWidth={92}
                  rightSection={
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={busy || !backendAvailable()}
                      onClick={() => void browseCore()}
                    >
                      {t("Browse")}
                    </Button>
                  }
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                />
                <Textarea
                  label={t("Arguments (one per line)")}
                  value={coreArgs}
                  onChange={(event) => setCoreArgs(event.currentTarget.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </Stack>
            )}
          </Alert>
        )}
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
        {error && !errorField && (
          <Alert
            ref={errorSummary}
            tabIndex={-1}
            color="red"
            icon={<AlertCircle size={17} />}
            role="alert"
          >
            {error}
          </Alert>
        )}
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            onClick={onClose}
            data-autofocus={locked || undefined}
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
                  clearError();
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
                onClick={() => void next()}
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
                  disabled={locked || needsCore || !backendAvailable()}
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
  requiresAcknowledgement = true,
}: {
  title: string;
  detail: string;
  label: string;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
  t: Translate;
  requiresAcknowledgement?: boolean;
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
        {requiresAcknowledgement && (
          <Checkbox
            label={title}
            checked={checked}
            onChange={(e) => setChecked(e.currentTarget.checked)}
            disabled={busy}
          />
        )}
        <Group justify="end">
          <Button
            data-autofocus
            variant="default"
            onClick={onClose}
            disabled={busy}
          >
            {t("Cancel")}
          </Button>
          <Button
            color="red"
            onClick={onConfirm}
            loading={busy}
            disabled={busy || (requiresAcknowledgement && !checked)}
          >
            {label}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
