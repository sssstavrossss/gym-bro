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

async function tapSize(page: Page, name: string) {
  return page.getByRole("radio", { name, exact: true }).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const after = getComputedStyle(node, "::after");
    let height = box.height;
    if (after.content !== "none" && after.position !== "static") {
      height += Math.abs(Math.min(0, parseFloat(after.top) || 0)) + Math.abs(Math.min(0, parseFloat(after.bottom) || 0));
    }
    return { width: box.width, height, visual: box.height };
  });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("calendar motion, home gap, compact profile controls, and a lean notification row", async ({ page }) => {
  const oid = `e2e-smooth-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const profile = {
    sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
    rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
    fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
  };
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", { headers: headers(oid), data: profile })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.removeItem("gymbro-home-week-open");
    document.documentElement.classList.add("demo-statusbar");
  }, oid);

  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const strip = page.locator(".homeweek");
  const macros = page.locator("main.today .macros");
  await expect(macros).toBeVisible();
  await expect(page.locator(".homeweek .grab")).toBeVisible();
  await expect(page.locator(".homeweek .cal")).toHaveAttribute("aria-hidden", "true");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone43-home-gap.png" });
  }

  const grab = page.getByRole("button", { name: "Show the last 4 weeks" });
  const stage = page.locator(".homeweek .stage");
  const closed = (await stage.boundingBox())!.height;
  // The calendar opens with a height transition, not a jump. This listens for the transition itself
  // rather than measuring heights a few frames in, since frame timing on a test machine without a GPU
  // depends on how fast it paints, not on the app.
  const opening = stage.evaluate((node) => new Promise<string>((done) => {
    node.addEventListener("transitionrun", (event) => {
      if (event.target === node && event.propertyName === "height") done(getComputedStyle(node).transitionDuration);
    });
  }));
  await grab.click();
  expect(await opening).toBe("0.34s");
  if (test.info().project.name === "chromium") {
    await page.waitForTimeout(50);
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone43-calendar-mid.png" });
  }
  await expect.poll(async () => page.locator(".homeweek .stage").evaluate((node) => node.style.height)).toBe("auto");
  expect((await stage.boundingBox())!.height).toBeGreaterThan(closed + 100);
  const calendar = page.getByRole("group", { name: "Last 4 weeks" });
  await expect(calendar).toBeVisible();
  // The key lists only what the four weeks show: a new account has nothing logged before today yet.
  const legend = calendar.locator(".legend").first();
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("on target → far off");
  await expect(calendar.locator("[data-week-totals]")).toContainText("Weigh-ins1of 1 day");
  for (const row of await calendar.locator(".legend").all()) {
    expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  if (test.info().project.name === "chromium") {
    await strip.screenshot({ path: "/opt/cursor/artifacts/iphone43-calendar-open.png" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "charcoal"; });
    await strip.screenshot({ path: "/opt/cursor/artifacts/iphone43-calendar-open-charcoal.png" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "graphite"; });
  }
  await page.getByRole("button", { name: "Hide the calendar" }).click();
  await expect(calendar).toBeHidden();
  await expect(page.locator(".homeweek .cal")).toHaveAttribute("aria-hidden", "true");

  await page.goto("/profile");
  for (const name of ["Male", "Female", "Lose", "Maintain", "Gain"]) {
    const hit = await tapSize(page, name);
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.visual).toBeLessThan(40);
  }
  const sex = page.getByRole("radiogroup", { name: "Sex" });
  const sexBox = await sex.boundingBox();
  expect(sexBox!.height).toBeLessThan(40);
  const goal = page.getByRole("radiogroup", { name: "Goal" });
  const goalBox = await goal.boundingBox();
  expect(goalBox!.height).toBeLessThan(40);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone43-profile-controls.png" });
  }

  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notes = page.getByRole("dialog", { name: "Notifications" });
  await expect(notes.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(notes.getByRole("switch", { name: /Weekly recalculate reminder/ })).toBeVisible();
  await expect(notes.getByText(/Monday morning/)).toBeVisible();
  await expect(notes.getByText(/push isn't set up on the server/)).toBeVisible();
  await expect(notes.getByText("Time to recalculate your target")).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await notes.screenshot({ path: "/opt/cursor/artifacts/iphone43-notifications.png" });
  }
});
