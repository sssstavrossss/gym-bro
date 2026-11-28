import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-workout-describe-${Date.now()}-${test.info().project.name}`;
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

test("Describe a workout: the words become exercises with their sets ticked off, and what isn't in the library is named", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");

  await page.getByRole("button", { name: "Empty workout" }).click();
  await page.getByRole("dialog", { name: "Workout" }).getByRole("button", { name: "Describe" }).click();
  const sheet = page.getByRole("dialog", { name: "Describe a workout" });
  await expect(sheet).toBeVisible();

  // Words the test model finds nothing in say so, and stay to be changed.
  await sheet.getByLabel("What you did").fill("juggling and knitting");
  await sheet.getByRole("button", { name: "Find exercises" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Couldn't find exercises in that");
  await expect(sheet.getByLabel("What you did")).toHaveValue("juggling and knitting");

  await sheet.getByLabel("What you did").fill("bench 3x8 60 kg, + pullups 3x10, run 5 km 25:30, juggling");
  await sheet.getByRole("button", { name: "Find exercises" }).click();

  const workout = page.getByRole("dialog", { name: "Workout" });
  await expect(workout.locator("[data-workout-status]")).toContainText("7 of 7 sets");
  await expect(workout.locator('[data-workout-exercise="barbell-bench-press-medium-grip"]')).toContainText("60 kg × 8, 8, 8");
  await expect(workout.locator("[data-superset]")).toHaveCount(1);
  await expect(workout.locator('[data-workout-exercise="run"]')).toContainText("5:06 /km");
  await expect(workout.locator("[data-describe-unmatched]")).toContainText("Couldn't find “juggling” in the library.");
  await workout.locator("[data-describe-unmatched]").getByRole("button", { name: "Dismiss" }).click();
  await expect(workout.locator("[data-describe-unmatched]")).toHaveCount(0);

  // The Describe button on the workout adds more to it.
  await workout.locator("[data-timeline] [data-describe-workout]").click();
  await sheet.getByLabel("What you did").fill("squat 2x5 100 kg");
  await sheet.getByRole("button", { name: "Find exercises" }).click();
  await expect(workout.locator("[data-workout-status]")).toContainText("9 of 9 sets");

  await workout.getByRole("button", { name: /^End now/ }).click();
  const done = page.getByRole("dialog", { name: "Workout done" });
  await expect(done.locator("[data-workout-summary]")).toContainText("60 kg × 8, 8, 8");
  await expect(done.locator("[data-workout-summary]")).toContainText("100 kg × 5, 5");
});
