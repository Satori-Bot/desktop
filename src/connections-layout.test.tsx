/// <reference types="node" />
import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndpointCard } from "./components/Common";
import { ConnectionsPage } from "./components/Pages";
import { translator } from "./i18n";
import { fixtureSnapshot } from "./test/fixtures";

const stylesheet = readFileSync("src/styles.css", "utf8");
let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.append(style);
});

afterEach(() => {
  cleanup();
  style.remove();
});

describe("Connections endpoint layout scope", () => {
  for (const language of ["en", "zh"] as const) {
    it.each([false, true])(
      `keeps ${language} actions in the flex column without changing Dashboard cards (tunnel failure: %s)`,
      (tunnelFailure) => {
        const snapshot = fixtureSnapshot({ tunnelFailure });
        const workspace = snapshot.workspaces[0];
        const status = snapshot.statuses[0];
        const t = translator(language);
        render(
          <MantineProvider env="test" forceColorScheme="light">
            <div className="endpoint-grid" data-testid="dashboard-endpoints">
              <EndpointCard
                status={status}
                access={workspace.access}
                isPublic={false}
                t={t}
                onCopy={vi.fn()}
              />
            </div>
            <div data-testid="connections">
              <ConnectionsPage
                workspace={workspace}
                status={status}
                run={async (_key, action) => action()}
                busy=""
                t={t}
                onEdit={vi.fn()}
                onRemove={vi.fn()}
                onCopy={vi.fn().mockResolvedValue(undefined)}
                onSaved={vi.fn()}
              />
            </div>
          </MantineProvider>,
        );
        const dashboardCard = screen
          .getByTestId("dashboard-endpoints")
          .querySelector(".endpoint-card")!;
        expect(getComputedStyle(dashboardCard).height).toBe("100%");
        const connections = screen.getByTestId("connections");
        const grid = connections.querySelector(".endpoint-grid")!;
        expect(grid.children).toHaveLength(2);
        // jsdom verifies the rendered structure and production CSS. The browser
        // suite separately checks actual bounding boxes at 1280px and 390px.
        for (const endpoint of Array.from(grid.children)) {
          expect(endpoint).toHaveClass("connection-endpoint");
          expect(getComputedStyle(endpoint).display).toBe("flex");
          expect(getComputedStyle(endpoint).flexDirection).toBe("column");
          expect(getComputedStyle(endpoint).minWidth).toBe("0");
          expect(endpoint.children).toHaveLength(2);
          const card = endpoint.firstElementChild!;
          const actions = endpoint.lastElementChild!;
          expect(card).toHaveClass("endpoint-card");
          expect(getComputedStyle(card).height).toBe("auto");
          expect(getComputedStyle(card).flexGrow).toBe("1");
          expect(actions).toHaveClass("connection-config-actions");
          expect(getComputedStyle(actions).flexShrink).toBe("0");
          expect(
            within(actions as HTMLElement).getByRole("button", {
              name: t("Copy config"),
            }),
          ).toBeVisible();
          expect(
            within(actions as HTMLElement).getByRole("button", {
              name: t("View configuration"),
            }),
          ).toBeVisible();
        }
        expect(
          grid.children[1].lastElementChild!.querySelectorAll("button"),
        ).toHaveLength(tunnelFailure ? 3 : 2);
        expect(grid.nextElementSibling).toHaveClass(
          "connection-authentication",
        );
        expect(grid.nextElementSibling).toHaveTextContent(t("Authentication"));
      },
    );
  }
});
