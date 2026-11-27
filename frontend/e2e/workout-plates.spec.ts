import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plates-${Date.now()}-${test.info().project.name}`;
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

test("a barbell lift shows the plates a side for the set you're on", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("barbell squat");
  await adding.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Workout" });
  const squat = page.locator('[data-exercise-screen][data-workout-exercise="barbell-squat"]');
  const plates = squat.locator("[data-plates]");
  await expect(plates).toHaveText("Plates show for the weight you type");

  await page.getByLabel("Set 1, kg", { exact: true }).fill("100");
  await expect(plates).toHaveText("Plates for 100 kg: 25 + 15 a side");
  await page.getByLabel("Set 1, Reps", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Log set 1" }).click();

  // The next set takes set 1's weight until another is typed.
  await expect(plates).toHaveText("Plates for 100 kg: 25 + 15 a side");
  await page.getByLabel("Set 2, kg", { exact: true }).fill("102.5");
  await expect(plates).toHaveText("Plates for 102.5 kg: 25 + 15 + 1.25 a side");
  await page.getByLabel("Set 2, kg", { exact: true }).fill("101");
  await expect(plates).toHaveText("Plates for 101 kg: 25 + 15 a side (100 kg)");

  // Not for kit that doesn't go on a bar.
  await page.getByRole("button", { name: "Back to the workout" }).click();
  await workout.getByRole("button", { name: "Exercise", exact: true }).click();
  await adding.getByLabel("Search exercises").fill("dumbbell bench press");
  await adding.getByRole("button", { name: "Add Dumbbell Bench Press", exact: true }).click();
  const dumbbells = page.locator('[data-exercise-screen][data-workout-exercise="dumbbell-bench-press"]');
  await expect(dumbbells).toBeVisible();
  await expect(dumbbells.locator("[data-plates]")).toHaveCount(0);
});
