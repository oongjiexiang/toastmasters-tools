import { test, expect, type Page } from "@playwright/test";

const FIXTURE_MEMBER = {
  email: "alice@example.com",
  name: "Alice Smith",
  title: "",
  pathways: [
    {
      pathway: "Engaging Humor",
      title: "",
      nextLevel: "Level 2",
      remaining: 3,
      status: "in-progress",
    },
  ],
};

async function mockMembers(page: Page, members: unknown[] = []) {
  await page.route("/api/members", (route) =>
    route.fulfill({ json: { data: members } }),
  );
}

test.describe("Dashboard refresh buttons", () => {
  test("both buttons visible when dashboard has no data", async ({ page }) => {
    await mockMembers(page, []);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Refresh Progress" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Membership" }),
    ).toBeVisible();
  });

  test("both buttons visible when data is loaded", async ({ page }) => {
    await mockMembers(page, [FIXTURE_MEMBER]);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Refresh Progress" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Membership" }),
    ).toBeVisible();
  });

  test("progress refresh shows loading toast and disables both buttons", async ({
    page,
  }) => {
    await mockMembers(page, []);
    await page.route("/api/refresh/progress", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ json: { data: { ok: true } } });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Refresh Progress" }).click();

    await expect(
      page.getByText("Fetching progress from Basecamp..."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Membership" }),
    ).toBeDisabled();

    await expect(page.getByText("Progress refreshed")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Membership" }),
    ).toBeEnabled();
  });

  test("membership refresh shows loading toast and disables both buttons", async ({
    page,
  }) => {
    await mockMembers(page, []);
    await page.route("/api/refresh/membership", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ json: { data: { ok: true } } });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Refresh Membership" }).click();

    await expect(
      page.getByText("Downloading membership from TI..."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Progress" }),
    ).toBeDisabled();

    await expect(page.getByText("Membership refreshed")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Progress" }),
    ).toBeEnabled();
  });

  test("error toast shown when refresh returns an error", async ({ page }) => {
    await mockMembers(page, []);
    await page.route("/api/refresh/progress", (route) =>
      route.fulfill({
        status: 500,
        json: {
          error: {
            message:
              "BASECAMP_SESSIONID is not set.\n  1. Log in to https://basecamp.toastmasters.org",
          },
        },
      }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Refresh Progress" }).click();

    await expect(
      page.getByText("BASECAMP_SESSIONID is not set."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh Progress" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Refresh Membership" }),
    ).toBeEnabled();
  });

  test("dashboard reloads member data after successful refresh", async ({
    page,
  }) => {
    let callCount = 0;
    await page.route("/api/members", (route) => {
      callCount++;
      route.fulfill({
        json: { data: callCount === 1 ? [] : [FIXTURE_MEMBER] },
      });
    });
    await page.route("/api/refresh/progress", (route) =>
      route.fulfill({ json: { data: { ok: true } } }),
    );

    await page.goto("/");
    await expect(page.getByText("No data yet")).toBeVisible();

    await page.getByRole("button", { name: "Refresh Progress" }).click();
    await expect(page.getByText("Progress refreshed")).toBeVisible();
    await expect(page.getByText("Alice Smith")).toBeVisible();
  });
});
