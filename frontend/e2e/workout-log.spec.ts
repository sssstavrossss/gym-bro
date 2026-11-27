import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-workout-log-${Date.now()}-${test.info().project.name}`;
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

test("A workout: start it, add an exercise, tick off sets, rest, finish, and see it saved", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");

  await page.getByRole("button", { name: "Empty workout" }).click();
  const sheet = page.getByRole("dialog", { name: "Add exercise" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Search exercises").fill("barbell bench press");
  await sheet.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip" }).click();

  // New to this exercise: its own screen with three empty sets, no "last time".
  const workout = page.getByRole("dialog", { name: "Workout" });
  const card = page.locator('[data-exercise-screen][data-workout-exercise="barbell-bench-press-medium-grip"]');
  await expect(card.getByText("First time")).toBeVisible();
  await expect(card.locator("[data-set]")).toHaveCount(3);

  await page.getByLabel("Set 1, kg").fill("60");
  await page.getByLabel("Set 1, Reps").fill("10");
  await page.getByRole("button", { name: "Log set 1" }).click();
  await expect(card.locator("[data-set]").first()).toHaveAttribute("data-done", "");
  // The next set offers the same numbers, and logging it takes them.
  await expect(page.getByLabel("Set 2, kg")).toHaveAttribute("placeholder", "60");
  await page.getByRole("button", { name: "Log set 2" }).click();
  await expect(page.locator("[data-exercise-status]")).toHaveText("Set 3 of 3");

  // A compound press rests 2:00, on a chip that skips it.
  const rest = page.locator("[data-rest]");
  await expect(rest.getByRole("timer")).toHaveText(/^(2:00|1:5\d)$/);
  await rest.click();
  await expect(rest).toHaveCount(0);
  // Done goes back to the workout, where the exercise is a line.
  await page.locator("[data-exercise-done]").click();
  await expect(workout.locator("[data-workout-status]")).toContainText("2 of 3 sets");
  await expect(workout.locator('[data-workout-exercise="barbell-bench-press-medium-grip"]')).toContainText("2 of 3 · 60 kg × 10, 10");

  // Closing keeps it going; Train offers to resume it, also after a reload.
  await workout.getByRole("button", { name: "Hide the workout" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();

  // End now asks about the set not ticked off, then leaves it out.
  await workout.getByRole("button", { name: /^End now/ }).click();
  await expect(workout.getByRole("alertdialog")).toContainText("1 set isn't ticked off");
  await workout.getByRole("alertdialog").getByRole("button", { name: "End workout" }).click();

  const done = page.getByRole("dialog", { name: "Workout done" });
  await expect(done.locator("[data-workout-summary]")).toContainText("1,200 kg");
  await expect(done.locator("[data-workout-summary]")).toContainText("60 kg × 10, 10");
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Empty workout" })).toBeVisible();

  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const list = await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) });
  const saved = (await list.json()).workouts;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ exercises: ["barbell-bench-press-medium-grip"], sets: 2, volumeKg: 1200 });

  // Next time, the exercise starts with last time's two sets, and last time above them.
  await page.getByRole("button", { name: "Empty workout" }).click();
  await page.getByRole("dialog", { name: "Add exercise" }).getByLabel("Search exercises").fill("barbell bench press");
  await page.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip" }).click();
  await expect(card.locator("[data-set]")).toHaveCount(2);
  await expect(card.locator("[data-last-time]")).toContainText("60 kg × 10, 10");
  // Every set reached the top of the range, so the first set offers 2.5 kg more.
  await expect(card.locator("[data-set]").first()).toContainText("62.5 × 6");

  // The how-to opens over the workout, and Esc goes back to it.
  await page.getByRole("button", { name: "How to do Barbell Bench Press - Medium Grip" }).click();
  await expect(page.getByRole("dialog", { name: "Barbell Bench Press - Medium Grip", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Barbell Bench Press - Medium Grip", exact: true })).toHaveCount(0);
  await expect(card).toBeVisible();

  // Discard throws it away, with Undo.
  await page.getByRole("button", { name: "Back to the workout" }).click();
  await workout.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Empty workout" })).toBeVisible();
  await page.locator(".toast.front").filter({ hasText: "Workout discarded" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-workout-card]")).toBeVisible();
});

test("History: open a past workout to edit it, delete it with Undo, and log one afterwards", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  const { zone, today } = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return { zone, today: new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) };
  });
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  // Ids are global, so each run makes its own.
  const id = crypto.randomUUID();
  const set = (kg: number, reps: number) => ({ exerciseId: "barbell-squat", block: 0, type: "working", kg, reps, doneAt: `${yesterday}T17:00:00Z` });
  const put = await page.request.put(`/api/workouts/${id}`, {
    headers: headers(oid),
    data: { date: yesterday, timeZone: zone, sets: [set(100, 5), set(100, 5)] },
  });
  expect(put.status(), await put.text()).toBe(201);

  await page.goto("/train");
  const history = page.locator("[data-workout-history]");
  const row = history.locator(`[data-workout-row="${id}"]`);
  await expect(row).toContainText("Barbell Squat · 2 sets · 1,000 kg");

  // Edit: untick a set and save.
  await row.click();
  const sheet = page.getByRole("dialog", { name: "Edit workout" });
  await expect(sheet.locator("[data-past-workout]")).toBeVisible();
  await sheet.getByRole("button", { name: "Set 2 done" }).click();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText("Barbell Squat · 1 set · 500 kg");

  // Delete, then Undo brings it back under the same id.
  await row.click();
  await page.getByRole("dialog", { name: "Edit workout" }).getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(row).toContainText("1 set");

  // Log past: a new workout on a day of your choosing.
  await history.getByRole("button", { name: "Log past" }).click();
  const add = page.getByRole("dialog", { name: "Add exercise" });
  await add.getByLabel("Search exercises").fill("plank");
  await add.locator('[data-exercise="plank"]:visible').click();
  const log = page.getByRole("dialog", { name: "Log a workout" });
  await log.getByLabel("Day of the workout").fill(yesterday);
  await log.getByRole("button", { name: "Save", exact: true }).click();
  await expect(log.getByRole("alert")).toHaveText("Tick off a set to save the workout.");
  await log.getByLabel("Set 1, Time").fill("100");
  await log.getByRole("button", { name: "Set 1 done" }).click();
  await log.getByRole("button", { name: "Save", exact: true }).click();
  await expect(log).toHaveCount(0);

  const list = await page.request.get(`/api/workouts?from=${yesterday}&to=${today}`, { headers: headers(oid) });
  const rows = (await list.json()).workouts;
  expect(rows.map((w: { exercises: string[]; date: string }) => [w.date, w.exercises[0]]).sort()).toEqual([[yesterday, "barbell-squat"], [yesterday, "plank"]].sort());
});
