import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
  });
}

const body = (zone: string) => ({
  sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
  rateKgPerWeek: 0.5, goalWeightKg: 78, proteinSetting: "normal", proteinGramsPerKg: 2,
  fatSetting: "normal", fatPercent: 25, timeZone: zone,
});

async function signIn(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

function sql(statement: string) {
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    env: { ...process.env, PGPASSWORD: "gymbro" },
  });
}

test("without enough data the burn is kept, and saving still writes the target", async ({ page }) => {
  const oid = `e2e-recalc-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers, data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", { headers, data: body(when.zone) })).ok()).toBeTruthy();
  await signIn(page, oid);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?recalculate=1");
  const sheet = page.getByRole("dialog", { name: "Recalculate" });
  await expect(sheet).toBeVisible();
  const burn = sheet.locator("[data-burn-card]");
  await expect(burn.getByRole("heading", { name: "Your burn was kept" })).toBeVisible();
  await expect(burn.getByRole("status")).toContainText("Weigh in at least once a week");
  await expect(burn.locator("[data-kept-burn]")).toBeVisible();
  await expect(sheet.locator("[data-low-days]")).toHaveCount(0);
  // The burn is still the formula's, so there is nothing different to offer.
  await expect(sheet.locator("[data-recalc-formula]")).toHaveCount(0);
  await expect(sheet.locator("[data-derivation]")).toContainText(/Target = burn [\d,]+ − 550 to lose 0\.5 kg a week\./);
  if (test.info().project.name === "chromium") {
    await sheet.screenshot({ path: "/opt/cursor/artifacts/recalculate-phone.png" });
  }
  await sheet.getByRole("button", { name: /^Accept/ }).click();
  await expect(page.getByText(/Target saved · burn stays at [\d,]+ until it can be measured/)).toBeVisible();
  const history = await (await page.request.get("/api/profile/history", { headers })).json();
  // Today's row already had the setup's profile_change; the recalculation adds its own reason.
  expect(history.rows[0].reasons).toContain("recalculation_kept");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Recalculate" })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.getByRole("dialog", { name: "Recalculate" }).screenshot({ path: "/opt/cursor/artifacts/recalculate-desktop.png" });
  }
});

test.describe("measured", () => {
  test.use({ timezoneId: "UTC" });

  test("a rare weigher is asked on Home and in Recalculate to weigh in weekly", async ({ page }) => {
    const oid = `e2e-recalc-rare-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
    expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers, data: { kg: 84.1, timeZone: "UTC" } })).ok()).toBeTruthy();
    expect((await page.request.put("/api/profile", { headers, data: body("UTC") })).ok()).toBeTruthy();
    // Set up five weeks ago with no weigh-in since.
    sql(`
      UPDATE profiles SET created_at = now() - interval '35 days' WHERE user_id = '${oid}';
      UPDATE target_history SET effective_date = current_date - 35, created_at = now() - interval '35 days' WHERE user_id = '${oid}';
      UPDATE weigh_ins SET local_date = current_date - 35 WHERE user_id = '${oid}';`);
    await signIn(page, oid);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today");
    const tip = page.locator("[data-weigh-nudge]");
    await expect(tip).toContainText("Weigh in once a week");
    await expect(tip).toContainText("So Gym Bro can learn your burn. Your last weigh-in was 5 weeks ago.");
    // It stacks behind this week's recalculate prompt; a sideways swipe brings it to the front, and another wraps back.
    const place = (key: string) => page.locator(`[data-stack-card="${key}"]`);
    await expect(place("recalc")).toHaveAttribute("data-place", "front");
    await expect(place("weigh")).toHaveAttribute("data-place", "back");
    const swipe = async (dx: number) => {
      const box = await page.locator("[data-stack-card][data-place=front] .txt").boundingBox();
      if (!box) throw new Error("no front card");
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 10 + dx, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    await swipe(-140);
    await expect(place("weigh")).toHaveAttribute("data-place", "front");
    await expect(place("recalc")).toHaveAttribute("data-place", "back");
    await swipe(140);
    await expect(place("recalc")).toHaveAttribute("data-place", "front");
    // Tabbing into the card behind brings it forward, so it can be reached without swiping.
    await tip.getByRole("button", { name: "Log weight" }).focus();
    await expect(place("weigh")).toHaveAttribute("data-place", "front");

    await page.goto("/today?recalculate=1");
    const burn = page.getByRole("dialog", { name: "Recalculate" }).locator("[data-burn-card]");
    await expect(burn.locator("[data-burn-blocked]")).toHaveText("Weigh in at least once a week so your burn can be measured.");
    await burn.locator("[data-burn-weigh]").click();
    await expect(page.getByRole("dialog", { name: "Log weight" })).toBeVisible();

    // ✕ hides the tip for a week on this device.
    await page.goto("/today");
    await swipe(-140);
    await expect(place("weigh")).toHaveAttribute("data-place", "front");
    await tip.getByRole("button", { name: "Hide for a week" }).click();
    await expect(tip).toHaveCount(0);
    await expect(place("recalc")).toHaveAttribute("data-place", "front");
    await page.reload();
    await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
    await expect(tip).toHaveCount(0);
  });

  test("low days must be answered, the burn is measured, and history keeps how", async ({ page }) => {
    const oid = `e2e-recalc-m-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
    expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers, data: { kg: 84.6, timeZone: "UTC" } })).ok()).toBeTruthy();
    expect((await page.request.put("/api/profile", { headers, data: body("UTC") })).ok()).toBeTruthy();
    // Three weeks: weigh-ins on a steady loss with some noise, and logs with three low days.
    sql(`
      UPDATE profiles SET created_at = now() - interval '21 days' WHERE user_id = '${oid}';
      UPDATE target_history SET effective_date = current_date - 21, created_at = now() - interval '21 days' WHERE user_id = '${oid}';
      DELETE FROM weigh_ins WHERE user_id = '${oid}';
      INSERT INTO weigh_ins (id, user_id, local_date, kg, updated_at)
        SELECT gen_random_uuid(), '${oid}', current_date - d, round((84.6 - 0.066 * (21 - d) + 0.35 * sin(d * 2.3))::numeric, 2), now()
        FROM generate_series(0, 21) d WHERE d NOT IN (3, 9, 10, 16);
      INSERT INTO log_entries (id, user_id, local_date, logged_at, time_zone, source, name, amount, unit, kcal, protein, fat, carbs, idempotency_key, food_owner_key)
        SELECT gen_random_uuid(), '${oid}', current_date - d, now() - (d || ' days')::interval, 'UTC', 'quick', 'Day', 1, '',
          CASE d WHEN 4 THEN 1120 WHEN 11 THEN 1310 WHEN 15 THEN 1540 ELSE 2150 + (100 * sin(d * 1.7))::int END, 160, 65, 220, gen_random_uuid()::text, ''
        FROM generate_series(1, 20) d WHERE d NOT IN (7, 13);`);
    await signIn(page, oid);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today?recalculate=1");
    const sheet = page.getByRole("dialog", { name: "Recalculate" });
    const low = sheet.locator("[data-low-days]");
    await expect(low).toHaveAttribute("data-low-days", "open");
    await expect(low.getByRole("heading", { name: "3 days look low" })).toBeVisible();
    await expect(low.locator("[data-low-day]")).toHaveCount(3);
    await expect(low).toContainText(/Counted: target [\d,]+\. Left out: [\d,]+\./);
    const accept = sheet.getByRole("button", { name: /^Accept/ });
    await expect(accept).toBeDisabled();
    await expect(sheet.locator("[data-answer-low]")).toBeVisible();

    await low.getByRole("button", { name: "Leave them out" }).click();
    await expect(low).toHaveAttribute("data-low-days", "answered");
    await expect(low).toContainText("3 low days left out");
    await expect(accept).toBeEnabled();

    const burn = sheet.locator("[data-burn-card]");
    await expect(burn.getByRole("heading", { name: "How your burn was measured" })).toBeVisible();
    await expect(burn.locator("[data-measured-burn]")).toContainText(/Readings point to.*[\d,]+ ± [\d,]+/s);
    // Two weeks of near-daily weigh-ins after the settling week, shown a week at a time.
    await expect(burn.locator("[data-reading]")).toHaveCount(2);
    await expect(burn.locator("[data-reading]").first()).toContainText(/Expected [\d.]+, weighed [\d.]+ kg/);
    await expect(burn.locator("[data-burn-step]")).toContainText(/moved \d+% of the way|Moved [\d,]+ of [\d,]+ kcal: a burn moves at most 5% per update/);
    await expect(sheet.locator("[data-recalc-formula]")).toBeVisible();

    await low.getByRole("button", { name: "Change" }).click();
    await expect(low).toHaveAttribute("data-low-days", "open");
    await low.getByRole("button", { name: "Count them" }).click();
    await expect(low).toContainText("3 low days counted");
    if (test.info().project.name === "chromium") {
      await sheet.screenshot({ path: "/opt/cursor/artifacts/recalculate-measured.png" });
    }
    await accept.click();
    await expect(page.getByText("Target recalculated from your logs")).toBeVisible();

    await page.goto("/profile");
    const history = page.locator("[data-target-history]");
    await history.scrollIntoViewIfNeeded();
    const top = history.locator("[data-history-item='row']").first();
    await expect(top).toContainText("Recalculated");
    await expect(top).toContainText(/Burn [\d,]+( → [\d,]+| · moved [\d,]+ of [\d,]+ \(5% cap\))/);
    await expect(top.locator("[data-change-chip]")).toBeVisible();
    await top.getByRole("button").click();
    const details = top.locator("[data-history-details]");
    await expect(details).toContainText("Readings point to");
    await expect(details).toContainText("Usual for you");
    await expect(details).toContainText("3 low");
    await expect(details).toContainText("Weigh-ins");

    // Log weight shows what today's weigh-in was expected to be from yesterday's and the food since.
    await page.goto("/today");
    await page.getByRole("button", { name: /Open weight|Log weight|Weigh in/ }).first().click();
    const weight = page.getByRole("dialog", { name: "Log weight" });
    const reading = weight.locator("[data-weigh-reading]");
    await expect(reading).toContainText(/Expected about [\d.]+ kg/);
    await expect(reading).toContainText(/From your food since yesterday and your burn of [\d,]+ kcal\./);
    await expect(reading.locator("[data-weigh-gap]")).toHaveText(/^([+−][\d.]+ kg|as expected)$/);
  });
});
