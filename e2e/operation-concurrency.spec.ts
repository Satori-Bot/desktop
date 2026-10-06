import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { changeError, ipcCalls, mockDesktop, resumeIpc } from "./fixtures";
import { translator } from "../src/i18n";
import { fixtureSnapshot } from "../src/test/fixtures";

const nav = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("button", { name, exact: true });

// Rendered in the existing CI browser job. All IPC and runtime paths are fixtures.
test("late runtime save survives reopened Settings and refresh failure without undoing the executable on the next edit", async ({
  page,
}) => {
  const snapshot = fixtureSnapshot({ stopped: true });
  snapshot.workspaces[0].coreCommand = ["/test-fixtures/old-core"];
  await mockDesktop(page, { snapshot, heldCommands: ["save_workspace"] });
  await page.goto("/");
  await nav(page, "Settings").click();
  await page.getByLabel("Executable path").fill("/test-fixtures/new-core");
  await page.getByRole("button", { name: "Save runtime selection" }).click();
  await expect.poll(() => ipcCalls(page, "save_workspace")).toHaveLength(1);
  await nav(page, "Dashboard").click();
  await nav(page, "Settings").click();
  await changeError(
    page,
    "snapshot",
    "TEST FIXTURE: temporary refresh failure",
  );
  await resumeIpc(page, "save_workspace");
  await expect(page.getByLabel("Executable path")).toHaveValue(
    "/test-fixtures/new-core",
  );
  await expect(
    page.getByRole("alert", { name: "Unable to refresh status" }),
  ).toContainText("TEST FIXTURE: temporary refresh failure");
  await expect(
    page.getByRole("button", { name: "Save runtime selection" }),
  ).toBeDisabled();
  await page.getByLabel("Arguments (one per line)").fill("--fixture-argument");
  await page.getByRole("button", { name: "Save runtime selection" }).click();
  await expect(
    page.getByRole("button", { name: "Save runtime selection" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Executable path")).toBeEnabled();
  const saves = await ipcCalls(page, "save_workspace");
  expect(saves).toHaveLength(2);
  expect(saves[1].args?.workspace).toMatchObject({
    id: "test-workspace",
    coreCommand: ["/test-fixtures/new-core", "--fixture-argument"],
  });
  await page.screenshot({
    path: "screenshots/runtime-save-refresh-recovery-test-fixture.png",
    fullPage: true,
  });
});

for (const language of ["en", "zh"] as const) {
  const t = translator(language);
  test(`pending installation keeps independent Stop reachable and workspace locks isolated (${language})`, async ({
    page,
  }) => {
    const snapshot = fixtureSnapshot();
    snapshot.settings.language = language;
    snapshot.workspaces.push({
      ...snapshot.workspaces[0],
      id: "birch-workspace",
      name: "Birch workspace",
      port: 8766,
    });
    snapshot.statuses.push({
      ...snapshot.statuses[0],
      workspaceId: "birch-workspace",
      pid: 5555,
    });
    await mockDesktop(page, {
      snapshot,
      heldCommands: ["install_core", "stop_workspace"],
    });
    await page.goto("/");
    await nav(page, t("Settings")).click();
    await page.getByLabel(t("Version to install")).fill("0.5.0");
    await page
      .getByRole("button", { name: t("Install version"), exact: true })
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
    await expect.poll(() => ipcCalls(page, "install_core")).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: t("Roll back"), exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: t("Quit application"), exact: true }),
    ).toBeDisabled();
    await nav(page, t("Dashboard")).click();
    const selector = page.getByRole("textbox", {
      name: t("Choose workspace"),
      exact: true,
    });
    await expect(selector).toBeEnabled();
    await selector.click();
    await page
      .getByRole("option", { name: "Birch workspace", exact: true })
      .click();
    const stop = page.getByRole("button", {
      name: t("Stop workspace"),
      exact: true,
    });
    await expect(stop).toBeEnabled();
    await stop.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => ipcCalls(page, "stop_workspace")).toHaveLength(1);
    expect((await ipcCalls(page, "stop_workspace"))[0].args).toEqual({
      id: "birch-workspace",
    });
    await expect(
      page.getByRole("button", { name: t("Restart"), exact: true }),
    ).toBeDisabled();
    await selector.click();
    await page
      .getByRole("option", { name: "Atlas workspace", exact: true })
      .click();
    await expect(stop).toBeEnabled();
    await expect(
      page.getByRole("status", { name: t("Background operation") }),
    ).toContainText(t("Installing core…"));
    await page.screenshot({
      path: `screenshots/independent-stop-during-install-${language}-test-fixture.png`,
      fullPage: true,
    });
    await resumeIpc(page, "install_core");
    await expect(
      page.getByRole("status", { name: t("Background operation") }),
    ).toHaveCount(0);
    await selector.click();
    await page
      .getByRole("option", { name: "Birch workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: t("Restart"), exact: true }),
    ).toBeDisabled();
    await resumeIpc(page, "stop_workspace");
    await expect(
      page.getByRole("button", { name: t("Start workspace"), exact: true }),
    ).toBeEnabled();
    await expect(selector).toHaveValue("Birch workspace");
    expect(await ipcCalls(page, "stop_workspace")).toHaveLength(1);
  });

  test(`port-only cleanup permits safe reconfiguration and explicit Stop retry (${language})`, async ({
    page,
  }) => {
    const snapshot = fixtureSnapshot({ stopped: true });
    snapshot.settings.language = language;
    Object.assign(snapshot.statuses[0], {
      state: "error",
      cleanupPending: false,
      portReleasePending: true,
    });
    await mockDesktop(page, { snapshot });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: t("Stop workspace"), exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText(t("Port is still unavailable"), { exact: true }),
    ).toBeVisible();
    await nav(page, t("Connections")).click();
    await expect(
      page.getByRole("button", { name: t("Edit workspace"), exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: t("Remove workspace"), exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: t("Remove this workspace?"),
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    expect(await ipcCalls(page, "delete_workspace")).toHaveLength(0);
    await confirmation
      .getByRole("button", { name: t("Cancel"), exact: true })
      .click();
    await nav(page, t("Settings")).click();
    await expect(page.getByLabel(t("Executable path"))).toBeEnabled();
    await nav(page, t("Dashboard")).click();
    await page
      .getByRole("button", { name: t("Stop workspace"), exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: t("Start workspace"), exact: true }),
    ).toBeEnabled();
    expect(await ipcCalls(page, "stop_workspace")).toHaveLength(1);
  });
}
