import { expect, test, type Page } from "@playwright/test";

const config = {
  tenantSubdomain: "contoso",
  tenantId: "tenant-id",
  spaClientId: "spa-id",
  apiClientId: "api-id",
  apiScope: "api://api-id/access_as_user",
};

async function openSignIn(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(config),
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gym Bro", exact: true })).toBeVisible();
  await expect(page.getByText("Sign in to set up your profile and targets.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}

function card(page: Page) {
  return page.locator(".signin-card");
}

async function boxOf(page: Page) {
  const box = await card(page).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("the sign-in card is centered on a large screen", async ({ page }) => {
  await openSignIn(page);
  const box = await boxOf(page);
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  expect(box.width).toBeLessThanOrEqual(480);
  expect(box.x).toBeGreaterThan(100);

  const heading = await page.getByRole("heading", { name: "Gym Bro", exact: true }).boundingBox();
  expect(Math.abs(heading!.x - box.x)).toBeLessThanOrEqual(2);

  const button = page.getByRole("button", { name: "Sign in" });
  await button.focus();
  await expect(button).toBeFocused();

  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportMeta ?? "").not.toMatch(/user-scalable\s*=\s*no/i);
  expect(viewportMeta ?? "").not.toMatch(/maximum-scale\s*=\s*1(?:\.0+)?\b/i);

  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/signin-after-desktop.png" });
  }
});

test("a phone keeps the card on screen, including large text and a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignIn(page);
  const fitted = await boxOf(page);
  const viewport = page.viewportSize()!;
  expect(Math.abs(fitted.x + fitted.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(fitted.y + fitted.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  await expectNoSideScroll(page);
  expect(fitted.x).toBeGreaterThanOrEqual(0);
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(viewport.width + 1);

  await page.evaluate(() => { document.documentElement.style.fontSize = "53px"; });
  await expectNoSideScroll(page);
  const large = await boxOf(page);
  expect(large.x).toBeGreaterThanOrEqual(0);
  expect(large.x + large.width).toBeLessThanOrEqual(viewport.width + 1);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  if (test.info().project.name === "webkit") {
    await page.screenshot({ path: "/opt/cursor/artifacts/signin-after-phone-large.png" });
  }

  await page.setViewportSize({ width: 390, height: 320 });
  await page.evaluate(() => { document.documentElement.classList.add("demo-statusbar"); });
  await expectNoSideScroll(page);
  const heading = page.getByRole("heading", { name: "Gym Bro", exact: true });
  const top = await heading.boundingBox();
  expect(top!.y).toBeGreaterThanOrEqual(54);
  const button = page.getByRole("button", { name: "Sign in" });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  const buttonBox = await button.boundingBox();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(391);
  expect(buttonBox!.height).toBeGreaterThan(0);
});

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(overflow).toBe(true);
}
