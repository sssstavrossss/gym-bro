import { expect, test, type Page } from "@playwright/test";

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
  });
}

test("the weekly reminder shows on Today and Profile until it is dismissed", async ({ page }) => {
  const oid = `e2e-inbox-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers, data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await expect(page.getByRole("status").filter({ hasText: "Time to recalculate your target" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Profile\s+Unread/ })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/banner-phone.png" });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("status").filter({ hasText: "Time to recalculate your target" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Profile\s+Unread/ })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/banner-desktop.png" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Profile" }).click();
  const section = page.getByRole("region", { name: "Notifications" });
  await expect(section.getByText("Time to recalculate your target").first()).toBeVisible();
  await expect(section.getByRole("heading", { name: /Notifications\s+Unread/ })).toBeVisible();
  await expect(section.getByText("Notifications are not set up.")).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/inbox-phone.png" });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("aside.side").getByRole("link", { name: /Profile\s+Unread/ })).toBeVisible();
  await expect(section.getByRole("heading", { name: /Notifications\s+Unread/ })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/inbox-desktop.png" });
  }

  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("link", { name: /Unread/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Profile" }).click();
  await section.getByRole("button", { name: /Time to recalculate/ }).click();
  await expect(page.getByRole("dialog", { name: "Recalculate" })).toBeVisible();
});
