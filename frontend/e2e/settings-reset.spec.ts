import { expect, test, type Page } from "@playwright/test";
import { addToWorkout } from "./timeline";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

/** A set-up user with a food of their own, two log entries and two workouts. */
async function setup(page: Page): Promise<string> {
  const oid = `e2e-reset-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  const h = headers(oid);
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: h, data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: h,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  const food = await page.request.post("/api/foods", {
    headers: h,
    data: { name: "Fictional reset oats", kcalPer100: 380, proteinPer100: 13, fatPer100: 7, carbsPer100: 60, basis: "g", nutrientBasis: "per_100" },
  });
  expect(food.ok()).toBeTruthy();
  const foodId = (await food.json()).id;
  for (const key of ["a", "b"]) {
    const logged = await page.request.post("/api/log-entries", {
      headers: h,
      data: { foodId, amount: 60, unit: "g", time: "08:00", idempotencyKey: `${key}-${oid}`, localDate: when.today, timeZone: when.zone },
    });
    expect(logged.ok()).toBeTruthy();
  }
  for (const name of ["Fictional legs", "Fictional push"]) {
    const saved = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
      headers: h,
      data: { date: when.today, timeZone: when.zone, name, sets: [{ exerciseId: "barbell-squat", kg: 80, reps: 8, doneAt: new Date().toISOString() }] },
    });
    expect(saved.ok()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  return oid;
}

async function openReset(page: Page) {
  await page.goto("/profile");
  await page.locator("[data-cog]").click();
  await page.locator("[data-reset-row]").click();
  return page.getByRole("dialog", { name: "Reset data" });
}

async function counts(page: Page, oid: string) {
  return (await page.request.get("/api/reset", { headers: headers(oid) })).json();
}

test("Reset training deletes the workouts and the one going on, and leaves the food log", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);

  // A workout going on this phone goes too. Quick start starts one at once; add an exercise so it is kept.
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  // Quick start opens the workout on its timeline; + Exercise opens Add exercise.
  await addToWorkout(page, "add-exercise");
  const add = page.getByRole("dialog", { name: "Add exercise" });
  await add.getByLabel("Search exercises").fill("barbell squat");
  await add.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`gymbro-workout:${id}`), oid)).not.toBeNull();

  const sheet = await openReset(page);
  const training = sheet.locator("[data-reset-training]");
  await expect(training.locator("[data-reset-count]")).toHaveText("2 workouts");
  await expect(sheet.locator("[data-reset-nutrition] [data-reset-count]")).toHaveText("2 entries over 1 day");

  // Keep closes the confirm without deleting.
  await training.getByRole("button", { name: "Reset", exact: true }).click();
  const confirm = training.getByRole("alertdialog", { name: "Reset training?" });
  await expect(confirm).toContainText("2 workouts with their sets and any workout going on this phone are deleted.");
  await confirm.getByRole("button", { name: "Keep" }).click();
  await expect(confirm).toHaveCount(0);
  expect((await counts(page, oid)).training.workouts).toBe(2);

  await training.getByRole("button", { name: "Reset", exact: true }).click();
  await confirm.getByRole("button", { name: "Reset training" }).click();
  await expect(page.getByText("Training reset · 2 workouts deleted")).toBeVisible();

  const after = await counts(page, oid);
  expect(after.training).toEqual({ workouts: 0, plan: null });
  expect(after.nutrition).toMatchObject({ entries: 2, foods: 1 });
  expect(await page.evaluate((id) => localStorage.getItem(`gymbro-workout:${id}`), oid)).toBeNull();

  // Nothing left to reset on that side.
  const again = await openReset(page);
  await expect(again.locator("[data-reset-training] [data-reset-count]")).toHaveText("Nothing yet");
  await expect(again.locator("[data-reset-training]").getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
});

test("Reset nutrition deletes the log, and with the switch your own foods, and leaves the workouts", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);

  const sheet = await openReset(page);
  const nutrition = sheet.locator("[data-reset-nutrition]");
  await expect(nutrition.getByRole("switch", { name: /Also my foods, recipes and groups/ })).toContainText("1 food · 0 recipes · 0 groups");
  await nutrition.getByRole("switch", { name: /Also my foods, recipes and groups/ }).click();
  await nutrition.getByRole("button", { name: "Reset", exact: true }).click();
  const confirm = nutrition.getByRole("alertdialog", { name: "Reset nutrition?" });
  await expect(confirm).toContainText("2 log entries and your foods, recipes and groups are deleted. Your workouts, weigh-ins and targets stay.");
  await confirm.getByRole("button", { name: "Reset nutrition" }).click();
  await expect(page.getByText("Nutrition reset · 2 entries and 1 food, recipe or group deleted")).toBeVisible();

  const after = await counts(page, oid);
  expect(after.nutrition).toEqual({ entries: 0, days: 0, foods: 0, recipes: 0, groups: 0 });
  expect(after.training.workouts).toBe(2);
  // The profile and targets are still there: the app opens at Profile, not set-up.
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Your targets" })).toBeVisible();
});
