import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { changeError, ipcCalls, mockDesktop } from "./fixtures";

const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true });
async function openDesktop(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Atlas workspace" }),
  ).toBeVisible();
}
async function startWizard(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create your first workspace" })
    .click();
  await page.getByLabel("Workspace name").fill("New project");
  await page.getByLabel("Folder path").fill("/test-fixtures/new-project");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `screenshots/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

test("real browser without Tauri has no fake workspace or telemetry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Browser preview only. No services are running here.",
  );
  await expect(page.locator(".main-footer")).toBeVisible();
  await expect(page.locator(".main-footer")).toContainText("BROWSER PREVIEW");
  await expect(page.getByText("Atlas workspace")).toHaveCount(0);
  await expect(page.getByText("CPU usage")).toHaveCount(0);
  await screenshot(page, "browser-unavailable");
  await page
    .getByRole("button", { name: "Create your first workspace" })
    .click();
  await expect(page.getByRole("button", { name: "Browse" })).toBeDisabled();
  await page.getByLabel("Workspace name").fill("Preview");
  await page.getByLabel("Folder path").fill("/preview");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create and start" }),
  ).toBeDisabled();
});

test("local-first onboarding handles back, cancel and native folder result", async ({
  page,
}) => {
  await mockDesktop(page, { empty: true });
  await startWizard(page);
  await expect(
    page.getByRole("textbox", { name: "Access", exact: true }),
  ).toHaveValue("Only this device");
  await expect(
    page.getByRole("radio", { name: "Safe", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Workspace name")).toHaveValue("New project");
  await expect(page.getByLabel("Folder path")).toHaveValue(
    "/test-fixtures/new-project",
  );
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(page.getByLabel("Folder path")).toHaveValue(
    "/test-fixtures/picked-project",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await ipcCalls(page, "save_workspace")).toHaveLength(0);
});

test("repeated create submit is locked and starts one safe local workspace", async ({
  page,
}) => {
  await mockDesktop(page, { empty: true, delays: { save_workspace: 300 } });
  await startWizard(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create and start" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    page.getByRole("heading", { name: "New project" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await ipcCalls(page, "save_workspace");
  expect(calls).toHaveLength(1);
  expect(calls[0].args?.workspace).toMatchObject({
    access: "local",
    auth: "noauth",
    permissionMode: "safe",
    port: 0,
  });
  expect(await ipcCalls(page, "start_workspace")).toHaveLength(1);
});

test("failed save retains draft and retry succeeds without hiding error", async ({
  page,
}) => {
  await mockDesktop(page, {
    empty: true,
    errors: { save_workspace: "TEST FIXTURE: folder permission denied" },
  });
  await startWizard(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "folder permission denied",
  );
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Workspace name")).toHaveValue("New project");
  await changeError(page, "save_workspace");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "New project" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await ipcCalls(page, "start_workspace")).toHaveLength(0);
});

test("saved workspace stays recoverable when start fails", async ({ page }) => {
  await mockDesktop(page, {
    empty: true,
    errors: { start_workspace: "TEST FIXTURE: runtime executable missing" },
  });
  await startWizard(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create and start" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Created successfully. Start failed; your workspace is saved and can be retried.",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start workspace", exact: true }),
  ).toBeEnabled();
  expect(await ipcCalls(page, "save_workspace")).toHaveLength(1);
});

test("dashboard light and dark screenshots use unmistakable test fixtures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDesktop(page);
  await openDesktop(page);
  await expect(page.getByText("read_file", { exact: true })).toBeVisible();
  await expect(page.locator("#test-fixture-label")).toBeVisible();
  await screenshot(page, "dashboard-light-test-fixture");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    "dark",
  );
  await screenshot(page, "dashboard-dark-test-fixture");
  expect(errors).toEqual([]);
});

test("active workspaces cannot edit configuration and copying never saves", async ({
  page,
}) => {
  await mockDesktop(page);
  await openDesktop(page);
  await nav(page, "Connections").click();
  await expect(
    page.getByRole("button", { name: "Edit workspace" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove workspace" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Copy config", exact: true })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("Copied");
  expect(await ipcCalls(page, "save_workspace")).toHaveLength(0);
  expect(await ipcCalls(page, "connection_config")).toEqual([
    {
      command: "connection_config",
      args: { id: "test-workspace", public: false },
    },
  ]);
  const clipboard = await page.evaluate(
    () =>
      (window as unknown as { __TEST_FIXTURE__: { clipboard: string[] } })
        .__TEST_FIXTURE__.clipboard,
  );
  expect(clipboard[0]).toContain("http://127.0.0.1:8765/mcp");
  await page
    .getByRole("button", { name: "Stop workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit workspace" }),
  ).toBeEnabled();
});

test("tunnel failure keeps local online and retry does not stop local service", async ({
  page,
}) => {
  await mockDesktop(page, { tunnelFailure: true });
  await openDesktop(page);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(
    page.getByText("http://127.0.0.1:8765/mcp", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Local service remains available. Fix the tunnel without restarting your tools.",
    ),
  ).toBeVisible();
  await screenshot(page, "public-failure-test-fixture");
  await nav(page, "Connections").click();
  await expect(page.getByLabel("Tunnel name")).toBeDisabled();
  await expect(page.getByLabel("Hostname", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry tunnel", exact: true }).click();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  expect(await ipcCalls(page, "retry_tunnel")).toHaveLength(1);
  expect(await ipcCalls(page, "stop_workspace")).toHaveLength(0);
});

test("activity supports search, failure filter, pending and empty result", async ({
  page,
}) => {
  await mockDesktop(page);
  await openDesktop(page);
  await nav(page, "Activity").click();
  await page.getByRole("textbox", { name: "Search tools" }).fill("EXECUTE");
  await expect(
    page.getByText("execute_command", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("read_file", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search tools" }).fill("");
  await page.getByRole("textbox", { name: "All outcomes" }).click();
  await page.getByRole("option", { name: "Failed", exact: true }).click();
  await expect(
    page.getByText("execute_command", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("search_code", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "All outcomes" }).click();
  await page.getByRole("option", { name: "In progress", exact: true }).click();
  await expect(page.getByText("search_code", { exact: true })).toBeVisible();
  await expect(page.getByText("execute_command", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("textbox", { name: "Search tools" }).fill("nonexistent");
  await expect(
    page.getByText("No matching calls", { exact: true }),
  ).toBeVisible();
});

test("language save rerenders navigation from saved settings", async ({
  page,
}) => {
  await mockDesktop(page);
  await openDesktop(page);
  await nav(page, "Settings").click();
  await page.getByRole("textbox", { name: "Language" }).click();
  await page.getByRole("option", { name: "简体中文" }).click();
  expect(await ipcCalls(page, "save_settings")).toHaveLength(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "偏好设置" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(await ipcCalls(page, "save_settings")).toEqual([
    {
      command: "save_settings",
      args: { settings: { language: "zh", closeToTray: true } },
    },
  ]);
  await nav(page, "概览").click();
  await expect(page.getByText("CPU 使用率", { exact: true })).toBeVisible();
});

async function expectFeedbackInViewport(page: Page, alert: Locator) {
  await expect(alert).toBeInViewport({ ratio: 1 });
  const bounds = await alert.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!bounds || !viewport) throw new Error("Feedback geometry unavailable");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`runtime save feedback stays in the scrolled Settings viewport at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockDesktop(page, {
      stopped: true,
      delays: { save_workspace: 350 },
    });
    await openDesktop(page);
    if (viewport.width < 800)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await nav(page, "Settings").click();
    await page.getByLabel("Executable path").fill("/test-fixtures/core-one");
    const save = page.getByRole("button", { name: "Save runtime selection" });
    await save.scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(100);
    await save.click();
    const feedback = page.getByRole("region", { name: "Operation feedback" });
    const success = feedback.getByRole("status");
    await expect(success).toHaveText("Saved");
    await expect(save).toBeDisabled();
    await expectFeedbackInViewport(page, success);
    await expect(feedback).toHaveCSS("position", "fixed");
    await expect(feedback).toHaveCSS("pointer-events", "none");
    await expect(success).toHaveCSS("pointer-events", "auto");
    expect(
      await feedback.evaluate((node) => Number(getComputedStyle(node).zIndex)),
    ).toBeLessThan(200);
    await page.screenshot({
      path: `screenshots/fixture-settings-saved-${viewport.width}.png`,
      animations: "disabled",
    });
    // Exercise the actual rule when a native webview omits safe-area variables.
    // Unknown env() names reproduce that standards-defined fallback path.
    const unavailableInsets = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText === ".operation-feedback"
          )
            return rule.cssText
              .replaceAll("safe-area-inset-top", "test-unavailable-inset-top")
              .replaceAll(
                "safe-area-inset-right",
                "test-unavailable-inset-right",
              );
        }
      }
      throw new Error("Production operation-feedback rule was not loaded");
    });
    await page.addStyleTag({ content: unavailableInsets });
    await expect(feedback).toHaveCSS("top", "16px");
    await expect(feedback).toHaveCSS("right", "16px");
    await expectFeedbackInViewport(page, success);

    await changeError(
      page,
      "save_workspace",
      "TEST FIXTURE: runtime selection denied",
    );
    await page.getByLabel("Executable path").fill("/test-fixtures/core-two");
    await save.click();
    await expect(success).toHaveCount(0);
    const error = feedback.getByRole("alert");
    await expect(error).toHaveText("TEST FIXTURE: runtime selection denied");
    await expectFeedbackInViewport(page, error);
    await page.screenshot({
      path: `screenshots/fixture-settings-error-${viewport.width}.png`,
      animations: "disabled",
    });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(page.getByLabel("Executable path")).toHaveValue(
      "/test-fixtures/core-two",
    );

    await changeError(page, "save_workspace");
    await save.click();
    await expect(error).toHaveCount(0);
    await expect(success).toHaveText("Saved");
    await expectFeedbackInViewport(page, success);
    await feedback
      .getByRole("button", { name: "Dismiss notification" })
      .click();
    await expect(feedback).toHaveCount(0);
    expect(await ipcCalls(page, "save_workspace")).toHaveLength(3);
  });
}

test("diagnostics, incremental logs and redacted download are explicit actions", async ({
  page,
}) => {
  await mockDesktop(page);
  await openDesktop(page);
  await nav(page, "Diagnostics").click();
  await expect(
    page.getByText("TEST FIXTURE runtime line 1", { exact: false }),
  ).toBeVisible();
  expect(await ipcCalls(page, "diagnose")).toHaveLength(0);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(
    page.getByText("TEST FIXTURE: local endpoint verified"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh logs" }).click();
  await expect(
    page.getByText("TEST FIXTURE runtime line 2", { exact: false }),
  ).toBeVisible();
  expect((await ipcCalls(page, "logs")).at(-1)?.args).toMatchObject({
    cursor: 1,
    kind: "runtime",
  });
  await page.getByText("Tunnel logs", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Tunnel logs" })).toBeChecked();
  await expect(
    page.getByText("TEST FIXTURE tunnel line 1", { exact: false }),
  ).toBeVisible();
  expect((await ipcCalls(page, "logs")).at(-1)?.args).toMatchObject({
    cursor: 0,
    kind: "tunnel",
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export diagnostics" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "coding-tools-diagnostics-Atlas_workspace.json",
  );
  expect(await ipcCalls(page, "export_diagnostics")).toHaveLength(1);
});

test("narrow viewport keeps controls reachable without horizontal document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDesktop(page);
  await openDesktop(page);
  await expect(
    page.getByRole("button", { name: "Stop workspace", exact: true }),
  ).toBeVisible();
  await screenshot(page, "dashboard-narrow-test-fixture");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await nav(page, "Settings").click();
  await expect(
    page.getByRole("heading", { name: "Preferences" }),
  ).toBeVisible();
});
