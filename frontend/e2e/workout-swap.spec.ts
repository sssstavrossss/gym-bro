import { expect, test, type Page } from "@playwright/test";

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
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("barbell squat");
  await adding.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Workout" });
  const squat = page.locator('[data-exercise-screen][data-workout-exercise="barbell-squat"]');
  await page.getByLabel("Set 1, kg").fill("100");
  await page.getByLabel("Set 1, Reps").fill("5");
  await page.getByRole("button", { name: "Log set 1" }).click();
  await squat.getByRole("button", { name: "Swap Barbell Squat" }).click();

  const swap = page.getByRole("dialog", { name: "Swap Barbell Squat" });
  const movement = swap.locator('[data-swap-group="movement"]');
  await expect(movement.getByRole("heading", { name: "Same movement" })).toBeVisible();
  await expect(movement.getByRole("button").first()).toHaveAccessibleName("Swap to Hack Squat");
  await expect(swap.locator('[data-swap-group="muscle"]').getByRole("heading", { name: "Same muscle" })).toBeVisible();
  await expect(swap.getByRole("heading", { name: "All exercises" })).toBeVisible();
  await movement.getByRole("button", { name: "Swap to Leg Press" }).click();

  await expect(page.getByText("Swapped Barbell Squat for Leg Press")).toBeVisible();
  // The two sets left move to the leg press, which opens on its screen, empty.
  const press = page.locator('[data-exercise-screen][data-workout-exercise="leg-press"]');
  await expect(press.locator("[data-set]")).toHaveCount(2);
  await expect(page.getByLabel("Set 1, kg")).toHaveValue("");

  // Going back from the swap screen changes nothing, and returns to the exercise.
  await press.getByRole("button", { name: "Swap Leg Press" }).click();
  await page.getByRole("dialog", { name: "Swap Leg Press" }).getByRole("button", { name: "Back to the exercise" }).click();
  await expect(press).toBeVisible();

  // The ticked set stays with the squat.
  await page.getByRole("button", { name: "Back to the workout" }).click();
  await expect(workout.locator('[data-workout-exercise="barbell-squat"]')).toContainText("100 kg × 5");
  await expect(workout.locator('[data-workout-exercise="leg-press"]')).toContainText("2 sets");
});
