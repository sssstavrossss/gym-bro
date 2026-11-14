import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("phone home calendar, history, sex, and notification circles", async ({ page }) => {
  const oid = `e2e-additions-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const profile = {
    sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
    rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
    fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
  };
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", { headers: headers(oid), data: profile })).ok()).toBeTruthy();
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 90, timeZone: when.zone, confirm: true } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/recalculate", { headers: headers(oid), data: { exclude: [], mode: "formula" } })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.removeItem("gymbro-home-week-open");
    document.documentElement.classList.add("demo-statusbar");
  }, oid);

  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const grab = page.getByRole("button", { name: "Show the last 4 weeks" });
  await expect(grab).toBeVisible();
  const grabBox = await grab.boundingBox();
  const grabHit = await grab.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const extra = getComputedStyle(node, "::after");
    const height = extra.position === "absolute" ? parseFloat(extra.height) : box.height;
    const width = extra.position === "absolute" ? parseFloat(extra.width) : box.width;
    return { width, height };
  });
  expect(grabHit.height).toBeGreaterThanOrEqual(44);
  expect(grabHit.width).toBeGreaterThanOrEqual(44);
  expect(grabBox!.width).toBeGreaterThanOrEqual(44);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-week-collapsed.png" });
  }
  await grab.click();
  const calendar = page.getByRole("group", { name: "Last 4 weeks" });
  await expect(calendar).toBeVisible();
  await expect.poll(async () => page.locator(".homeweek .stage").evaluate((node) => node.style.height)).toBe("auto");
  await expect.poll(async () => (await calendar.getByRole("button").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
  if (test.info().project.name === "chromium") {
    const block = page.locator(".homeweek");
    await block.screenshot({ path: "/opt/cursor/artifacts/iphone42-week-expanded.png" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "midnight"; });
    await block.screenshot({ path: "/opt/cursor/artifacts/iphone42-week-expanded-midnight.png" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "graphite"; });
  }
  const remembered = await page.evaluate(() => localStorage.getItem("gymbro-home-week-open"));
  expect(remembered).toBe("1");
  await page.getByRole("button", { name: "Hide the calendar" }).click();
  await expect(calendar).toBeHidden();

  await page.goto("/profile");
  const sex = page.getByRole("radiogroup", { name: "Sex" });
  const male = sex.getByRole("radio", { name: "Male", exact: true });
  await expect(male).toBeChecked();
  const sexBox = await sex.boundingBox();
  const row = await page.locator(".about .sexrow").boundingBox();
  expect(sexBox!.width).toBeLessThan((row!.width) * 0.8);
  expect(sexBox!.x).toBeGreaterThan(row!.x + 40);
  for (const name of ["Male", "Female"]) {
    const hit = await sex.getByRole("radio", { name, exact: true }).evaluate((node) => {
      const box = node.getBoundingClientRect();
      const after = getComputedStyle(node, "::after");
      let height = box.height;
      if (after.content !== "none" && after.position !== "static") {
        const extra = Math.abs(Math.min(0, parseFloat(after.top) || 0)) + Math.abs(Math.min(0, parseFloat(after.bottom) || 0));
        height += extra;
      }
      return { width: box.width, height, visual: box.height };
    });
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.visual).toBeLessThan(40);
  }
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-sex-after.png" });
  }

  const notes = page.getByRole("region", { name: "Notifications" });
  await notes.scrollIntoViewIfNeeded();
  const toggle = notes.getByRole("button", { name: "Weekly recalculate" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const mark = await toggle.locator(".dot").boundingBox();
  expect(mark!.width).toBeCloseTo(16, 0);
  expect(mark!.height).toBeCloseTo(16, 0);
  await expect(notes.getByText("Notifications are not set up.")).toBeVisible();
  await expect(notes.getByRole("button", { name: "Enable notifications" })).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await notes.screenshot({ path: "/opt/cursor/artifacts/iphone42-notifications-after.png" });
  }

  const history = page.locator("[data-target-history]");
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByText("Recalculated", { exact: true })).toBeVisible();
  await expect(history.getByText("From the formula")).toBeVisible();
  await expect(history.getByRole("button", { name: "Show fewer" })).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await history.screenshot({ path: "/opt/cursor/artifacts/iphone42-history-recalculated.png" });
  }
});
