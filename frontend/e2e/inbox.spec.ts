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
  // The open reminder shows on Today, so the Profile tab has no dot for it.
  const prompt = page.getByRole("region", { name: "Recalculate this week" });
  await expect(prompt).toBeVisible();
  await expect(page.getByRole("link", { name: /Unread/ })).toHaveCount(0);
  const box = await prompt.boundingBox();
  expect(box && box.height < 140).toBeTruthy();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/recalc-prompt-phone.png" });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(prompt).toBeVisible();
  await expect(page.locator("aside.side").getByRole("link", { name: /Unread/ })).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/recalc-prompt-desktop.png" });
  }

  // Recalculate opens the sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.getByRole("button", { name: "Recalculate", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Recalculate" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Recalculate" })).toHaveCount(0);
  await expect(prompt).toBeVisible();

  // Profile lists it as on Today instead of repeating it.
  await page.getByRole("link", { name: "Profile" }).click();
  const section = page.getByRole("region", { name: "Notifications" });
  await expect(section.getByRole("switch", { name: /Weekly recalculate reminder/ })).toBeVisible();
  await expect(section.getByText("Monday morning", { exact: false })).toBeVisible();
  await expect(section.getByText("Time to recalculate your target")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
  const recent = section.locator("[data-recent-notes] li");
  await expect(recent).toHaveCount(1);
  await expect(recent.first()).toContainText("Recalculate reminder");
  await expect(recent.first().getByRole("link", { name: "On Today" })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/opt/cursor/artifacts/notifications-phone.png" });
  }

  // ✕ dismisses it for the week; Profile then shows it as done.
  await recent.first().getByRole("link", { name: "On Today" }).click();
  await page.getByRole("region", { name: "Recalculate this week" }).getByRole("button", { name: "Dismiss for this week" }).click();
  await expect(page.getByRole("region", { name: "Recalculate this week" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recalculate this week" })).toHaveCount(0);
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).locator("[data-recent-notes] li").first()).toContainText("Done");
});
