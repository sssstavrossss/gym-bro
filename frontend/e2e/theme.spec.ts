import { expect, test, type Page } from "@playwright/test";

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("switching theme changes the background and persists", async ({ page }) => {
  const oid = `e2e-theme-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
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
  await sign(page, oid);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  const quiet = await page.evaluate(() => {
    const active = document.activeElement;
    return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
  });
  expect(quiet).toBe(true);

  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe("rgb(22, 24, 29)");

  await page.getByRole("radio", { name: "Midnight navy" }).click();
  expect(await background()).toBe("rgb(18, 24, 38)");
  expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe("#121826");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Midnight navy" })).toHaveAttribute("aria-checked", "true");
  expect(await background()).toBe("rgb(18, 24, 38)");

  await page.getByRole("radio", { name: "Graphite" }).click();
});
