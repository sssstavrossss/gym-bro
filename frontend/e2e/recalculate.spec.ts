import { expect, test, type Page } from "@playwright/test";

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
  });
}

test("recalculate explains missing data and can save the formula", async ({ page }) => {
  const oid = `e2e-recalc-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  const weigh = await page.request.put(`/api/weigh-ins/${when.today}`, { headers, data: { kg: 83.6, timeZone: when.zone } });
  expect(weigh.ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?recalculate=1");
  const sheet = page.getByRole("dialog", { name: "Recalculate" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("status")).toContainText("Fewer than 7 days");
  await expect(sheet.getByRole("checkbox", { name: /Day complete/ })).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await sheet.screenshot({ path: "/opt/cursor/artifacts/recalculate-phone.png" });
  }
  await sheet.getByRole("button", { name: "Use the formula instead" }).click();
  await expect(page.getByText("Target recalculated from the formula.")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("Notifications are not set up.")).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/recalculate-profile.png" });
  }
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Recalculate" })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.getByRole("dialog", { name: "Recalculate" }).screenshot({ path: "/opt/cursor/artifacts/recalculate-desktop.png" });
  }
});
