import { expect, test, type Page } from "@playwright/test";
import { pick, setRow } from "./dial";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
  const oid = `e2e-load-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const day = 86_400_000;
    return { zone, today: format(new Date()), days: [format(new Date(Date.now() - 4 * day)), format(new Date(Date.now() - 2 * day))] };
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

const set = (exerciseId: string, kg: number, reps: number, rir: number) => ({ exerciseId, block: 0, type: "working", kg, reps, rir, doneAt: new Date().toISOString() });

test("a plan workout suggests each lift's weight from the last two times, and ticking a set takes it", async ({ page }) => {
  await page.goto("/");
  const { oid, zone, days } = await setup(page);
  const weekday = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const made = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "muscle", weekdays: [0, 1, 2, 3].map((n) => (weekday + n) % 7).sort((a, b) => a - b), minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], timeZone: "UTC" },
  });
  expect(made.status(), await made.text()).toBe(201);
  const ids = ((await made.json()).workouts[0].exercises as { exerciseId: string }[]).map((exercise) => exercise.exerciseId);
  expect(ids.slice(0, 3)).toEqual(["barbell-bench-press-medium-grip", "bent-over-barbell-row", "standing-military-press"]);

  // Free workouts before the plan: the bench reached the top of its range; the row fell short twice.
  const bench = "barbell-bench-press-medium-grip";
  const row = "bent-over-barbell-row";
  for (const [index, date] of days.entries()) {
    const sets = [set(row, 70, 5, 1), set(row, 70, 4, 0)];
    if (index === 1) sets.push(set(bench, 60, 10, 3), set(bench, 60, 10, 3), set(bench, 60, 11, 3));
    const saved = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, { headers: headers(oid), data: { date, timeZone: zone, kind: "strength", status: "done", sets } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }

  await page.goto("/train");
  await page.locator("[data-up-next]").getByRole("button", { name: "Start Upper A" }).click();
  const workout = page.getByRole("dialog", { name: "Upper A" });

  const benchSet = setRow(workout, bench, 0);
  await expect(workout.locator('[data-load-suggestion="up"]')).toHaveText("Try 62.5 kg, up 2.5: every set reached 10 last time");
  // The suggestion is the set's grey hint, and ticking it off takes it.
  await expect(benchSet.getByLabel("Set 1, kg")).toContainText("62.5");
  await expect(benchSet.getByLabel("Set 1, Reps")).toContainText("6");
  await benchSet.getByRole("button", { name: "Set 1 done" }).click();
  await expect(benchSet).toHaveAttribute("data-done", "");
  await expect(benchSet.getByLabel("Set 1, kg")).toContainText("62.5");
  await expect(benchSet.getByLabel("Set 1, Reps")).toContainText("6");

  await workout.locator(`[data-workout-exercise="${row}"]`).getByRole("button").first().click();
  await expect(workout.locator(`[data-workout-exercise="${row}"][data-open]`)).toBeVisible();
  await expect(workout.locator('[data-load-suggestion="ease"]')).toHaveText("Try 62.5 kg, down 7.5: short of the range twice");
  await expect(setRow(workout, row, 0).getByLabel("Set 1, kg")).toContainText("62.5");

  await workout.locator('[data-workout-exercise="standing-military-press"]').getByRole("button").first().click();
  await expect(workout.locator('[data-load-suggestion="first"]')).toHaveText("First time: pick a weight that leaves about 3 reps");
  await expect(workout.locator('[data-info="standing-military-press"]')).not.toContainText("· First time");
});
