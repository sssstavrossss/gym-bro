import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plan-edit-${Date.now()}-${test.info().project.name}`;
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

test("Edit a plan workout: steppers, move, swap, add and remove, then save; it starts that way", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  const weekday = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const weekdays = [0, 1, 2, 3].map((n) => (weekday + n) % 7).sort((a, b) => a - b);
  const made = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "muscle", weekdays, minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], timeZone: "UTC" },
  });
  expect(made.status(), await made.text()).toBe(201);
  await page.goto("/train");

  await page.getByRole("button", { name: "Edit Upper A" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit Upper A" });
  const save = sheet.locator("[data-plan-workout-save]");
  await expect(sheet.locator("[data-plan-workout-summary]")).toHaveText("6 exercises · 18 sets · ~55 min");
  await expect(save).toBeDisabled();

  // Open the bench press: one more set, a lower rep range, then move it down.
  const bench = sheet.locator('[data-plan-exercise="barbell-bench-press-medium-grip"]');
  await expect(bench.locator("[data-plan-exercise-line]")).toHaveText("3 × 6–10 · Rest 2:00");
  await bench.getByRole("button", { name: /Barbell Bench Press/ }).first().click();
  await bench.getByRole("button", { name: "One set more" }).click();
  await expect(bench.locator("[data-plan-sets]")).toHaveText("4");
  await bench.getByRole("button", { name: "Fewer reps at most" }).click();
  await bench.getByRole("button", { name: "Fewer reps at least" }).click();
  await expect(bench.locator("[data-plan-exercise-line]")).toHaveText("4 × 5–9 · Rest 2:00");
  await expect(save).toBeEnabled();
  await bench.getByRole("button", { name: "Move Barbell Bench Press - Medium Grip down" }).click();
  await expect(sheet.locator("[data-plan-exercise]").nth(1)).toHaveAttribute("data-plan-exercise", "barbell-bench-press-medium-grip");

  // Swap it for a dumbbell press: it keeps its sets, range and rest.
  await bench.locator("[data-plan-swap]").click();
  const swap = page.getByRole("dialog", { name: "Swap Barbell Bench Press - Medium Grip" });
  await swap.locator('[data-swap-group="movement"]').getByRole("button", { name: "Swap to Dumbbell Bench Press" }).click();
  await expect(page.getByText("Swapped Barbell Bench Press - Medium Grip for Dumbbell Bench Press")).toBeVisible();
  const press = sheet.locator('[data-plan-exercise="dumbbell-bench-press"]');
  await expect(press.locator("[data-plan-exercise-line]")).toHaveText("4 × 5–9 · Rest 2:00");

  // Add a plank (a hold), and remove the curl.
  await sheet.getByRole("button", { name: "Exercise", exact: true }).click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("plank");
  await adding.getByRole("button", { name: "Add Plank", exact: true }).click();
  const plank = sheet.locator('[data-plan-exercise="plank"]');
  await expect(plank.locator("[data-plan-exercise-line]")).toHaveText("3 × 45 s · Rest 1:00");
  await plank.getByRole("button", { name: "15 seconds more hold" }).click();
  await expect(plank.locator("[data-plan-hold]")).toHaveText("1:00");
  const curl = sheet.locator('[data-plan-exercise="dumbbell-bicep-curl"]');
  await curl.getByRole("button", { name: /Dumbbell Bicep Curl/ }).first().click();
  await curl.getByRole("button", { name: "Remove Dumbbell Bicep Curl" }).click();
  await expect(curl).toHaveCount(0);

  await save.click();
  await expect(page.getByText("Saved Upper A")).toBeVisible();
  await expect(sheet).toBeHidden();
  const row = page.locator('[data-plan-workout="Upper A"]');
  await expect(row.locator("[data-plan-edited]")).toHaveText("Edited by you");
  await expect(row).toContainText("Dumbbell Bench Press");

  const saved = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan.workouts[0];
  expect(saved.edited).toBe(true);
  expect(saved.exercises.map((item: { exerciseId: string }) => item.exerciseId)).toEqual([
    "bent-over-barbell-row", "dumbbell-bench-press", "standing-military-press", "wide-grip-lat-pulldown", "side-lateral-raise", "plank",
  ]);
  expect(saved.exercises[1]).toMatchObject({ sets: 4, repMin: 5, repMax: 9, restSeconds: 120 });
  expect(saved.exercises[5]).toMatchObject({ sets: 3, seconds: 60, repMin: null });

  // Starting it uses the edit.
  await page.locator("[data-up-next]").getByRole("button", { name: "Start Upper A" }).click();
  const workout = page.getByRole("dialog", { name: "Upper A" });
  await expect(workout.locator('[data-workout-exercise="plank"]')).toHaveCount(1);
  await expect(workout.locator('[data-workout-exercise="dumbbell-bicep-curl"]')).toHaveCount(0);
  await workout.getByRole("button", { name: "Hide the workout" }).click();

  // Remaking the plan from its answers says the edit goes.
  await page.locator("[data-plan-card]").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("[data-plan-edits-note]")).toContainText("Your changes to Upper A won't be kept.");
});
