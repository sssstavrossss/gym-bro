import { expect, test, type Page } from "@playwright/test";
import { pick, setRow } from "./dial";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-swap-${Date.now()}-${test.info().project.name}`;
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

test("Swap an exercise: similar ones first, ticked sets stay, the rest move", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  // Quick start opens the workout on its timeline; + Exercise opens Add exercise.
  await page.getByRole("dialog", { name: "Workout" }).locator("[data-add-exercise]").click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("barbell squat");
  await adding.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Workout" });
  await pick(page, workout.getByLabel("Set 1, kg"), 100);
  await pick(page, workout.getByLabel("Set 1, Reps"), 5);
  await workout.getByRole("button", { name: "Set 1 done" }).click();
  await workout.getByRole("button", { name: "Swap Barbell Squat" }).click();

  const swap = page.getByRole("dialog", { name: "Swap Barbell Squat" });
  const movement = swap.locator('[data-swap-group="movement"]');
  await expect(movement.getByRole("heading", { name: "Same movement" })).toBeVisible();
  await expect(movement.getByRole("button").first()).toHaveAccessibleName("Swap to Hack Squat");
  await expect(swap.locator('[data-swap-group="muscle"]').getByRole("heading", { name: "Same muscle" })).toBeVisible();
  await expect(swap.getByRole("heading", { name: "All exercises" })).toBeVisible();
  await movement.getByRole("button", { name: "Swap to Leg Press" }).click();

  await expect(page.getByText("Swapped Barbell Squat for Leg Press")).toBeVisible();
  // The two sets left move to the leg press, which opens on the timeline, empty.
  const pressSets = workout.locator('[data-set][data-exercise="leg-press"]');
  await expect(workout.locator('[data-workout-exercise="leg-press"][data-open]')).toBeVisible();
  await expect(pressSets).toHaveCount(2);
  await expect(setRow(workout, "leg-press", 0).getByLabel("Set 1, kg")).toHaveText(/—$/);

  // Going back from the swap screen changes nothing.
  await workout.getByRole("button", { name: "Swap Leg Press" }).click();
  await page.getByRole("dialog", { name: "Swap Leg Press" }).getByRole("button", { name: "Back to the workout" }).click();
  await expect(pressSets).toHaveCount(2);

  // The ticked set stays with the squat.
  await expect(workout.locator('[data-workout-exercise="barbell-squat"]')).toContainText("100 kg × 5");
  await expect(workout.locator('[data-workout-exercise="leg-press"]')).toContainText("2 sets");
});
