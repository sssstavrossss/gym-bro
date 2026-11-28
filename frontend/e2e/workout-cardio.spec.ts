import { expect, test, type Page } from "@playwright/test";
import { pick } from "./dial";
import { addToWorkout } from "./timeline";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-cardio-${Date.now()}-${test.info().project.name}`;
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

test("a run saves as cardio with its pace and distance", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  // Quick start opens the workout on its timeline; + Exercise opens Add exercise.
  await addToWorkout(page, "add-exercise");
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("run");
  await adding.getByRole("button", { name: "Add Run", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Workout" });
  // Cardio starts with one set: one run.
  await expect(workout.locator('[data-set][data-exercise="run"]')).toHaveCount(1);
  await pick(page, workout.getByLabel("Set 1, m", { exact: true }), 5000);
  await pick(page, workout.getByLabel("Set 1, Time", { exact: true }), 2500);
  await expect(workout.locator("[data-pace]")).toHaveText("Pace 5:00 /km");
  await workout.getByRole("button", { name: "Set 1 done" }).click();
  // Done, the run folds to its heading; no rest after cardio.
  await expect(workout.locator('[data-workout-exercise="run"]')).not.toHaveAttribute("data-open");
  await expect(workout.locator('[data-workout-exercise="run"]')).toContainText("5 km");
  await expect(workout.locator("[data-rest]")).toHaveCount(0);

  await workout.getByRole("button", { name: /^End now/ }).click();
  const done = page.getByRole("dialog", { name: "Workout done" });
  await expect(done.locator("[data-summary-distance]")).toContainText("5 km");
  await expect(done.getByText("Volume", { exact: true })).toHaveCount(0);
  await expect(done).toContainText("5 km · 25:00 · 5:00 /km");
  await done.getByRole("button", { name: "Done", exact: true }).click();

  await expect(page.locator("[data-workout-row]").first()).toContainText("Run · 1 set · 5 km");
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const list = (await (await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) })).json()).workouts;
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ kind: "cardio", sets: 1, volumeKg: 0, metres: 5000 });
});
