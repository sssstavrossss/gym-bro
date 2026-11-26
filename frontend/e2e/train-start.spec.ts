import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-train-start-${Date.now()}-${test.info().project.name}`;
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

test("A first visit: start a workout, make a plan, explore by body area, and log what you did before, with no empty History", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");

  // Nothing logged yet: no History card, just the prompt to log past workouts.
  const before = page.locator("[data-trained-before]");
  await expect(before).toContainText("Trained before?");
  await expect(page.locator("[data-workout-history]")).toHaveCount(0);
  await expect(page.locator("[data-start-workout]")).toContainText("Start a workout");
  await expect(page.locator("[data-plan-card]")).toContainText("Make a plan");

  // A body area opens the library on that area.
  const explore = page.locator("[data-explore]");
  await explore.getByRole("button", { name: "Legs", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Exercises" });
  await expect(library.getByRole("button", { name: "Legs", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Browsing doesn't raise the keyboard: the search field waits for a tap.
  await expect(library.getByLabel("Search exercises")).not.toBeFocused();
  await expect(library.locator('[data-exercise="barbell-squat"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(library).toHaveCount(0);
  // The next time it opens from the top, on every area.
  await explore.locator("[data-explore-exercises]").click();
  await expect(library.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // ✨ starts a workout straight on Describe.
  await page.getByRole("button", { name: "Describe a workout" }).click();
  const describe = page.getByRole("dialog", { name: "Describe a workout" });
  await expect(describe.getByLabel("What you did")).toBeVisible();
  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  // WebKit can drop a tap made while the sheet is still sliding in; tap again until it lands.
  await expect(async () => {
    await describe.getByRole("button", { name: "Back to the workout" }).click();
    await expect(workout).toBeVisible({ timeout: 1000 });
  }).toPass();
  await workout.getByRole("button", { name: "Hide the workout" }).click();

  // While it runs, the start makes way for the workout in progress.
  await expect(page.locator("[data-start-workout]")).toHaveCount(0);
  await page.locator("[data-workout-card]").getByRole("button", { name: "Resume" }).click();
  // Still empty, so it opens on Add exercise.
  await page.getByRole("dialog", { name: "Add exercise" }).getByRole("button", { name: "Back to the workout" }).click();
  await workout.getByRole("button", { name: "Discard" }).click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("[data-start-workout]")).toBeVisible();

  // Log past from the prompt; once saved, History takes the prompt's place.
  await before.getByRole("button", { name: "Log past" }).click();
  const add = page.getByRole("dialog", { name: "Add exercise" });
  await add.getByLabel("Search exercises").fill("plank");
  await add.locator('[data-exercise="plank"]').click();
  const log = page.getByRole("dialog", { name: "Log a workout" });
  await log.getByLabel("Set 1, Time").fill("60");
  await log.getByRole("button", { name: "Set 1 done" }).click();
  await log.getByRole("button", { name: "Save", exact: true }).click();
  await expect(log).toHaveCount(0);
  await expect(page.locator("[data-workout-history]")).toContainText("Plank");
  await expect(before).toHaveCount(0);

  const results = await new AxeBuilder({ page }).include("main").analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => item.id))).toEqual([]);
});

test("Repeat starts the last workout again: its name, its exercises in order, and as many sets as last time", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  const { zone, yesterday } = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 86_400_000));
    return { zone, yesterday: day };
  });
  const doneAt = `${yesterday}T17:00:00Z`;
  const put = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
    headers: { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" },
    data: {
      date: yesterday, timeZone: zone, name: "Leg day",
      sets: [
        { exerciseId: "barbell-squat", block: 0, type: "warmup", kg: 40, reps: 8, doneAt },
        { exerciseId: "barbell-squat", block: 0, type: "working", kg: 100, reps: 5, doneAt },
        { exerciseId: "barbell-squat", block: 0, type: "working", kg: 100, reps: 5, doneAt },
        { exerciseId: "plank", block: 1, type: "working", seconds: 60, doneAt },
      ],
    },
  });
  expect(put.status(), await put.text()).toBe(201);

  await page.goto("/train");
  const start = page.locator("[data-start-workout]");
  await expect(start).toContainText("repeat Leg day");
  await start.getByRole("button", { name: "Repeat Leg day", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Leg day" });
  await expect(workout).toBeVisible();
  const lifts = workout.locator("[data-workout-exercise]");
  await expect(lifts).toHaveCount(2);
  await expect(lifts.first()).toHaveAttribute("data-workout-exercise", "barbell-squat");
  // Two working sets last time (the warm-up doesn't count), none ticked off yet.
  await expect(workout.locator("[data-workout-status]")).toContainText("0 of 3 sets");
  await workout.getByRole("button", { name: "Discard" }).click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
});
