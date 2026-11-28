import { expect, test, type Page } from "@playwright/test";
import { pick } from "./dial";
import { addToWorkout } from "./timeline";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-number-dial-${Date.now()}-${test.info().project.name}`;
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

test("The number wheel: an exercise's rest is picked on the arc, by finger, step and keyboard, and the timer uses it", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  // Quick start opens the workout on its timeline; + Exercise opens Add exercise.
  await addToWorkout(page, "add-exercise");
  const add = page.getByRole("dialog", { name: "Add exercise" });
  await add.getByLabel("Search exercises").fill("barbell squat");
  await add.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();
  const workout = page.getByRole("dialog", { name: "Workout" });
  // A heavy leg lift rests 3:00: each rest still to come says so, and changes on a tap.
  const restButton = workout.locator("[data-rest-setting]").first();
  await expect(restButton).toHaveText("3:00");

  // The wheel opens on the rest, with a heavy lift's steps (30 s ours) and a hint.
  await restButton.click();
  const dial = page.getByRole("dialog", { name: "Rest · Barbell Squat" });
  const value = dial.locator("[data-dial-value]");
  await expect(value).toHaveText("3:00min");
  await expect(dial).toContainText("Heavy leg lift: starts at 3:00");
  await expect(dial.locator("[data-dial-step]")).toHaveText(["15 s", "30 s", "1 min"]);
  await expect(dial.locator('[data-dial-step="30"]')).toHaveAttribute("aria-pressed", "true");
  await expect(dial.locator("[data-dial-reset]")).toBeDisabled();
  await expect(dial.locator("[data-dial-track]")).toBeFocused();

  // A finger's scroll moves it whole steps: two to the left is 2:00.
  const track = dial.locator("[data-dial-track]");
  await track.evaluate((el) => el.scrollBy({ left: -80, behavior: "instant" }));
  await expect(value).toHaveText("2:00min");
  await expect(dial.locator("[data-dial-reset]")).toBeEnabled();
  // A key steps it; ↺ goes back to where it opened.
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveText("2:30min");
  await dial.locator("[data-dial-reset]").click();
  await expect(value).toHaveText("3:00min");

  // Another step keeps the value and moves by it; digits typed jump to a number (a clock reads from the right).
  await dial.locator('[data-dial-step="15"]').click();
  await expect(value).toHaveText("3:00min");
  await page.keyboard.press("ArrowLeft");
  await expect(value).toHaveText("2:45min");
  await page.keyboard.type("215");
  await expect(value).toHaveText("2:15min");
  await page.keyboard.press("Enter");
  await expect(dial).toHaveCount(0);
  await expect(restButton).toHaveText("2:15");

  // × cancels; the step picked is kept for next time.
  await restButton.click();
  await expect(dial.locator('[data-dial-step="15"]')).toHaveAttribute("aria-pressed", "true");
  await expect(track).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveText("2:30min");
  await dial.locator("[data-dial-cancel]").click();
  await expect(dial).toHaveCount(0);
  await expect(restButton).toHaveText("2:15");

  // The ✓ keeps it, and the rest after the next set runs that long.
  await restButton.click();
  await expect(track).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveText("2:30min");
  await dial.locator("[data-dial-keep]").click();
  await expect(restButton).toHaveText("2:30");
  await pick(page, workout.getByLabel("Set 1, kg"), 100);
  await pick(page, workout.getByLabel("Set 1, Reps"), 5);
  await workout.getByRole("button", { name: "Set 1 done" }).click();
  const timer = workout.locator("[data-rest] [role=timer]");
  await expect(timer).toHaveText(/^2:(2\d|30)$/);

  // The rest running changes on the wheel too, from its "of 2:30": this rest, and the squat's from now on.
  await workout.locator("[data-rest-length]").click();
  const running = page.getByRole("dialog", { name: "Rest · Barbell Squat" });
  await expect(running.locator("[data-dial-value]")).toHaveText("2:30min");
  await page.keyboard.type("400");
  await expect(running.locator("[data-dial-value]")).toHaveText("4:00min");
  await page.keyboard.press("Enter");
  await expect(timer).toHaveText(/^(4:00|3:5\d)$/);
  await expect(restButton).toHaveText("4:00");
  await expect(workout.locator("[data-rest-length]")).toHaveText("of 4:00");
});
