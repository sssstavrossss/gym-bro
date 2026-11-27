import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plan-next-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
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
  return oid;
}

test("Up next: skip with Undo, start the plan workout prefilled, finish it, and the plan moves on", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  // Today and the three days after it, so the calendar starts today.
  const weekday = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const weekdays = [0, 1, 2, 3].map((n) => (weekday + n) % 7).sort((a, b) => a - b);
  const made = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "muscle", weekdays, minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], timeZone: "UTC" },
  });
  expect(made.status(), await made.text()).toBe(201);
  const upperA = (await made.json()).workouts[0] as { exercises: { sets: number }[] };
  const sets = upperA.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  await page.goto("/train");

  const next = page.locator("[data-up-next]");
  await expect(next).toContainText("Upper A");
  await expect(next).toContainText("Week 1 of 6 · 3 reps in reserve");
  await expect(next.locator("[data-next-day]")).toHaveText("Today");
  // This week, Monday to Sunday: today ringed with Upper A, tomorrow (when it's still this week) Lower A.
  const week = next.locator("[data-week] li");
  await expect(week).toHaveCount(7);
  const { today, tomorrow } = await page.evaluate(() => {
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return { today: day(new Date()), tomorrow: day(new Date(Date.now() + 86_400_000)) };
  });
  const todayDisc = next.locator(`[data-week] [data-date="${today}"]`);
  await expect(todayDisc).toHaveAttribute("data-state", "today");
  await expect(todayDisc).toContainText("Upper A, today");
  const tomorrowDisc = next.locator(`[data-week] [data-date="${tomorrow}"]`);
  if (weekday < 6) {
    await expect(tomorrowDisc).toHaveAttribute("data-state", "planned");
    await expect(tomorrowDisc).toContainText("Lower A");
  }

  // Skip moves on, and Undo brings it back.
  await next.getByRole("button", { name: "Skip Upper A" }).click();
  await expect(next).toContainText("Lower A");
  await expect(page.locator("[data-workout-history]")).toContainText("Skipped");
  await expect(todayDisc).toHaveAttribute("data-state", "skipped");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(next).toContainText("Upper A");
  // With nothing left in it, History goes away.
  await expect(page.locator("[data-workout-history]")).toHaveCount(0);

  // Start opens the plan workout with its exercises, sets and targets.
  await next.getByRole("button", { name: "Start Upper A" }).click();
  const workout = page.getByRole("dialog", { name: "Upper A" });
  await expect(workout).toBeVisible();
  await expect(workout.locator("[data-workout-exercise]")).toHaveCount(upperA.exercises.length);
  const card = workout.locator('[data-workout-exercise="barbell-bench-press-medium-grip"][data-open]');
  await expect(card).toContainText("6–10 reps · 3 in reserve");
  await expect(card.locator("[data-set]")).toHaveCount(3);
  await expect(card.getByLabel("Set 1, RIR")).toHaveAttribute("placeholder", "3");
  await expect(workout.locator("[data-workout-status]")).toContainText(`0 of ${sets} sets`);

  await card.getByLabel("Set 1, kg").fill("60");
  await card.getByLabel("Set 1, Reps").fill("8");
  await card.getByRole("button", { name: "Set 1 done" }).click();
  // The plan's rest for a big upper-body lift: 2:00.
  await expect(workout.locator("[data-rest]").getByRole("timer")).toHaveText(/^(2:00|1:5\d)$/);

  // While it runs, Up next says so and offers no Start or Skip.
  await workout.getByRole("button", { name: "Hide the workout" }).click();
  await expect(next.locator("[data-up-next-running]")).toBeVisible();
  await expect(next.getByRole("button", { name: "Skip Upper A" })).toHaveCount(0);

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await workout.getByRole("button", { name: /^End now/ }).click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "End workout" }).click();
  await page.getByRole("dialog", { name: "Workout done" }).getByRole("button", { name: "Done", exact: true }).click();

  await expect(next).toContainText("Lower A");
  // Done today, so the next one goes on the next training day.
  await expect(next.locator("[data-next-day]")).toHaveText("Tomorrow");
  await expect(todayDisc).toHaveAttribute("data-state", "done");
  const plan = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan;
  expect(plan.lastPosition).toBe(0);
  const saved = (await (await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) })).json()).workouts;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: "Upper A", status: "done", sequencePosition: 0, planWorkoutId: plan.workouts[0].id, sets: 1 });
});
