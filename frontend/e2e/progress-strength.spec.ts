import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
  const oid = `e2e-strength-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const day = 86_400_000;
    return { zone, today: format(new Date()), days: [format(new Date(Date.now() - 10 * day)), format(new Date(Date.now() - 3 * day))] };
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
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  return { oid, ...when };
}

const set = (exerciseId: string, kg: number, reps: number, rir: number, type = "working") => ({ exerciseId, block: 0, type, kg, reps, rir, doneAt: new Date().toISOString() });

test("Progress → Strength shows workouts, sets and each lift's estimated max, and stays picked", async ({ page }) => {
  await page.goto("/");
  const { oid, zone, days } = await setup(page);
  const squat = "barbell-squat";
  const bench = "barbell-bench-press-medium-grip";
  const workouts = [
    // 100 × 5 at 2 in reserve is 123.33; the warm-up doesn't count.
    { date: days[0], sets: [set(squat, 60, 5, 5, "warmup"), set(squat, 100, 5, 2)] },
    // 105 × 5 at 2 in reserve is 129.5: up 6 since the first day.
    { date: days[1], sets: [set(squat, 105, 5, 2), set(squat, 100, 5, 3), set(bench, 80, 8, 2)] },
  ];
  for (const workout of workouts) {
    const saved = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
      headers: headers(oid),
      data: { date: workout.date, timeZone: zone, kind: "strength", status: "done", sets: workout.sets },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }

  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Progress", exact: true })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Strength" }).click();

  const stats = page.locator("[data-strength-stats]");
  await expect(stats).toContainText("Workouts2done in this range");
  await expect(stats).toContainText("Sets4not counting warm-ups");
  await expect(stats).toContainText("Lifts up1of 1 done on 2 days or more");

  const lifts = page.locator("[data-strength-lifts]");
  const squatRow = lifts.locator(`[data-lift="${squat}"]`);
  await expect(squatRow).toContainText("Barbell Squat");
  await expect(squatRow).toContainText(/\+6 kg since \d{1,2} \w{3}/);
  await expect(squatRow).toContainText("129.5 kg");
  await expect(lifts.locator(`[data-lift="${bench}"]`)).toContainText("Once in this range");
  // Done more often first.
  await expect(lifts.locator("li[data-lift]").first()).toHaveAttribute("data-lift", squat);

  // The page doesn't scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // The view is remembered.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Strength" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-strength-stats]")).toBeVisible();
  await page.getByRole("radio", { name: "Body" }).click();
  await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
  await expect(page.locator("[data-strength-stats]")).toHaveCount(0);
});

test("This week counts sets per muscle against the target and names what's not worked yet", async ({ page }) => {
  await page.goto("/");
  const { oid, zone, today } = await setup(page);
  const saved = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
    headers: headers(oid),
    data: {
      date: today, timeZone: zone, kind: "strength", status: "done",
      sets: [set("barbell-squat", 60, 5, 5, "warmup"), set("barbell-squat", 100, 5, 2), set("barbell-squat", 100, 5, 2), { ...set("pullups", 0, 8, 2), kg: null }],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  await page.goto("/progress");
  await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Strength" }).click();
  const week = page.locator("[data-muscle-week]");
  await expect(week).toContainText("Aim for 10–14 sets a muscle (no plan, so some experience)");
  // Two squat sets count for quadriceps; the warm-up doesn't.
  const quads = week.locator('[data-muscle-sets="quadriceps"]');
  await expect(quads).toContainText("2 sets");
  await expect(quads).toContainText("8 to go · 1 day");
  await expect(quads).toHaveAttribute("data-status", "under");
  // A pull-up helps the biceps: half a set.
  await expect(week.locator('[data-muscle-sets="biceps"]')).toContainText("0.5 sets");
  await expect(week.locator('[data-muscle-sets="biceps"]')).toContainText("helping only");
  await expect(week.locator("[data-muscle-not-yet]")).toHaveText("Not yet this week: Chest, Shoulders, Triceps and Abdominals.");
  await expect(week.locator('[data-muscle="quadriceps"]').first()).toHaveClass(/help/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
