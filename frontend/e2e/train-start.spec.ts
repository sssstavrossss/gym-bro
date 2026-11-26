import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
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
  await describe.getByRole("button", { name: "Back to the workout" }).click();
  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  await expect(workout).toBeVisible();
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
