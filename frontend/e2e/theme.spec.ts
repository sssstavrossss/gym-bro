import { expect, test, type Page } from "@playwright/test";

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("switching theme and accent changes the colours and persists", async ({ page }) => {
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
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  const quiet = await page.evaluate(() => {
    const active = document.activeElement;
    return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
  });
  expect(quiet).toBe(true);

  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe("rgb(22, 24, 29)");

  // WebKit can report the old computed colour for a moment after a click, so these poll.
  await page.getByRole("radio", { name: "Midnight navy" }).click();
  await expect.poll(() => background()).toBe("rgb(18, 24, 38)");
  expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe("#121826");
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "Midnight navy" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => background()).toBe("rgb(18, 24, 38)");

  await page.getByRole("radio", { name: "Graphite" }).click();

  // Accent: Mono by default. Lagoon paints buttons teal, bars sky and over stripes pink, and stays
  // after a reload. The theme behind it doesn't change.
  const settings = page.getByRole("dialog", { name: "Settings" });
  const accents = settings.getByRole("radiogroup", { name: "Accent" });
  await expect(accents.getByRole("radio", { name: "Mono" })).toHaveAttribute("aria-checked", "true");
  const token = (name: string) => page.evaluate((key) => getComputedStyle(document.documentElement).getPropertyValue(key).trim(), name);
  await expect.poll(() => token("--color-action")).toBe("#ffffff");
  const preview = settings.locator("[data-accent-preview]");
  const addFace = () => preview.locator(".btn.primary").evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
  await expect.poll(() => addFace()).toBe("rgb(255, 255, 255)");

  await accents.getByRole("radio", { name: "Lagoon" }).click();
  await expect(settings.locator("[data-accent-name]")).toHaveText("Lagoon");
  await expect.poll(() => addFace()).toBe("rgb(153, 246, 228)");
  await expect.poll(() => preview.locator(".fill").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(125, 211, 252)");
  await expect.poll(() => preview.locator(".bar.over .fill").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("rgb(253, 164, 175)");
  await expect.poll(() => background()).toBe("rgb(22, 24, 29)");

  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBe("lagoon");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(settings.getByRole("radiogroup", { name: "Accent" }).getByRole("radio", { name: "Lagoon" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => token("--chart-line")).toBe("#7dd3fc");

  await settings.getByRole("radiogroup", { name: "Accent" }).getByRole("radio", { name: "Mono" }).click();
  await expect.poll(() => token("--chart-line")).toBe("#7db1ff");
  await expect.poll(addFace).toBe("rgb(255, 255, 255)");
});
