import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
  const oid = `e2e-week-training-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const now = new Date();
    return { zone, today: format(now), tomorrow: format(new Date(now.getTime() + 86_400_000)), weekday: (now.getDay() + 6) % 7 };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  // A plan from tomorrow (strength), and a run done today, 5.2 km in 30 minutes.
  const plan = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "muscle", weekdays: [(when.weekday + 1) % 7, (when.weekday + 3) % 7].sort((a, b) => a - b), minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], timeZone: when.zone },
  });
  expect(plan.ok(), await plan.text()).toBeTruthy();
  const started = new Date(Date.now() - 40 * 60_000);
  const run = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
    headers: headers(oid),
    data: {
      date: when.today, timeZone: when.zone, name: "Run", status: "done",
      startedAt: started.toISOString(), endedAt: new Date(started.getTime() + 30 * 60_000).toISOString(),
      sets: [{ exerciseId: "run", block: 0, type: "working", metres: 5200, seconds: 1800, doneAt: new Date().toISOString() }],
    },
  });
  expect(run.ok(), await run.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.removeItem("gymbro-home-week-open");
  }, oid);
  return when;
}

test("the week strip and calendar show workouts by kind and state, and a tapped tile opens its day", async ({ page }) => {
  await page.goto("/");
  const when = await setup(page);
  // On a Sunday tomorrow is next week, outside the calendar's four weeks.
  const tomorrowShown = when.weekday < 6;
  await page.goto("/today");

  // The strip: today's run is a done cardio badge on the date, tomorrow's plan workout a planned strength one.
  const week = page.getByRole("group", { name: "This week" });
  const todayDay = week.getByRole("button", { name: /Run done/ });
  await expect(todayDay.locator('[data-train-badge="cardio done"]')).toBeVisible();
  if (tomorrowShown) await expect(week.locator('[data-train-badge="strength planned"]').first()).toBeVisible();

  // The calendar: the same badges, today's weigh-in, and the four weeks' totals.
  await page.getByRole("button", { name: "Show the last 4 weeks" }).click();
  const calendar = page.getByRole("group", { name: "Last 4 weeks" });
  await expect(calendar).toBeVisible();
  await expect.poll(async () => page.locator(".homeweek .stage").evaluate((node) => (node as HTMLElement).style.height)).toBe("auto");
  const todayTile = calendar.locator(`.tile[data-date="${when.today}"]`);
  await expect(todayTile.locator('[data-train-badge="cardio done"]')).toBeVisible();
  await expect(todayTile.locator("[data-weighed]")).toBeVisible();
  await expect(todayTile).toHaveAttribute("aria-label", /Run done, weighed in/);
  const totals = calendar.locator("[data-week-totals]");
  await expect(totals).toContainText("Workouts1none skipped");
  await expect(totals).toContainText("Weigh-ins1of 1 day");
  await expect(calendar.locator(".legend").filter({ hasText: "cardio" })).toBeVisible();

  // A tap opens the day's card in the totals' place; nothing below moves.
  const height = (await page.locator(".homeweek").boundingBox())!.height;
  await todayTile.click();
  const card = calendar.locator("[data-day-card]");
  await expect(card).toBeVisible();
  await expect(todayTile).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("Today");
  await expect(card.locator("[data-day-kcal]")).toHaveText("Nothing logged");
  await expect(card.locator("[data-day-workout]")).toHaveText(/Run\s*· 5\.2 km · 30 min/);
  await expect(card.locator("[data-day-weight]")).toHaveText("83.6 kg");
  await expect(totals).toBeHidden();
  expect((await page.locator(".homeweek").boundingBox())!.height).toBeCloseTo(height, 0);

  if (tomorrowShown) {
    await calendar.locator(`.tile[data-date="${when.tomorrow}"]`).click();
    await expect(card).toContainText("Tomorrow");
    await expect(card.locator("[data-day-kcal]")).toHaveText("Nothing planned");
    await expect(card.locator("[data-day-workout]")).toHaveText(/Planned · about \d+ min/);
    await expect(card.locator("[data-day-workout] [data-train-badge]")).toHaveAttribute("data-train-badge", "strength planned");
    await expect(card.locator("[data-day-weight]")).toHaveText("No weigh-in");
  }

  // × closes the card and brings the totals back.
  await card.locator("[data-day-close]").click();
  await expect(card).toHaveCount(0);
  await expect(totals).toBeVisible();

  // A second tap on the same tile goes to that day, as a tap did before.
  await todayTile.click();
  await todayTile.click();
  await expect(calendar).toBeHidden();
  await expect(todayDay).toHaveAttribute("aria-pressed", "true");

  // Open day does the same from the card.
  if (tomorrowShown) {
    await page.getByRole("button", { name: "Show the last 4 weeks" }).click();
    await calendar.locator(`.tile[data-date="${when.tomorrow}"]`).click();
    await card.locator("[data-day-open]").click();
    await expect(calendar).toBeHidden();
    await expect(week.getByRole("button", { pressed: true })).toHaveAttribute("aria-label", /selected/);
    await expect(week.getByRole("button", { pressed: true })).toHaveAttribute("aria-label", /planned/);
  }
});
