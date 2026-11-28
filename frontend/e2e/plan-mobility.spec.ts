import { expect, test, type Locator, type Page } from "@playwright/test";
import { closeMenu, exerciseMenu, menu } from "./timeline";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plan-mobility-${Date.now()}-${test.info().project.name}`;
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

/** Until a sheet has slid in, WebKit can drop a tap on it. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

test("Plan: a mobility warm-up and cool-down frame each workout", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");

  // Both are off until asked for, in Your training.
  await page.locator("[data-training-open]").click();
  const training = page.getByRole("dialog", { name: "Your training" });
  await settled(training);
  const warm = training.getByRole("switch", { name: "Mobility warm-up" });
  const cool = training.getByRole("switch", { name: "Cool-down" });
  await expect(warm).toHaveAttribute("aria-checked", "false");
  await expect(cool).toHaveAttribute("aria-checked", "false");
  await warm.click();
  await cool.click();
  await expect(warm).toHaveAttribute("aria-checked", "true");
  await training.getByRole("button", { name: "Close" }).click();

  await page.locator("[data-see-plan]").click();
  const sheet = page.getByRole("dialog", { name: "New plan" });
  await settled(sheet);
  await expect(sheet.locator('[data-plan-new-workout="Full body A"]')).toContainText("+ 3 min warm-up · 3 min cool-down");
  await sheet.locator("[data-plan-save]").click();
  await expect(sheet).toBeHidden();

  const card = page.locator("[data-plan-card]");
  await expect(card.locator('[data-plan-workout="Full body A"] [data-plan-mobility]')).toHaveText("+ 3 min warm-up · 3 min cool-down");
  const saved = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan;
  expect([saved.warmUp, saved.coolDown]).toEqual([true, true]);
  const first = saved.workouts[0] as { name: string; warmUp: unknown[]; exercises: unknown[]; coolDown: unknown[] };

  // Started, the workout runs warm-up, workout, cool-down, each under its heading.
  await page.locator("[data-up-next]").getByRole("button", { name: `Start ${first.name}` }).click();
  const workout = page.getByRole("dialog", { name: first.name });
  await expect(workout.locator("h3[data-part]")).toHaveText(["Warm-up", "Workout", "Cool-down"]);
  await expect(workout.locator("[data-workout-exercise]")).toHaveCount(first.warmUp.length + first.exercises.length + first.coolDown.length);
  await expect(workout.locator("[data-workout-exercise]").first()).toHaveAttribute("data-workout-exercise", (first.warmUp[0] as { exerciseId: string }).exerciseId);
  // The first move is open: it goes for 30 s, with no warm-up set of its own.
  await expect(workout.locator("[data-workout-exercise][data-open]")).toHaveCount(1);
  const move = (await exerciseMenu(page, (first.warmUp[0] as { exerciseId: string }).exerciseId)).locator("[data-info]");
  await expect(move).toContainText("30 s");
  await expect(move).toContainText("First time");
  await closeMenu(page);
  // The + offers no warm-up sets for a warm-up move.
  await workout.locator("[data-timeline-add]").click();
  await expect(menu(page).locator('[data-menu-item="add-set"]')).toBeVisible();
  await expect(menu(page).locator('[data-menu-item="add-warmup"]')).toHaveCount(0);
  await closeMenu(page);

  // Turned off again in Your training, the plan follows at once: same workouts, and the line goes.
  await page.goto("/train");
  await page.locator("[data-training-open]").click();
  await settled(training);
  await expect(training.locator("[data-training-total]")).toContainText("about");
  await warm.click();
  await cool.click();
  await training.getByRole("button", { name: "Close" }).click();
  await expect(training).toBeHidden();
  await expect(card.locator("[data-plan-mobility]")).toHaveCount(0);
  await expect(page.locator("[data-training-behind]")).toHaveCount(0);
  const after = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan;
  expect([after.warmUp, after.coolDown]).toEqual([false, false]);
  expect(after.workouts.map((item: { exercises: unknown[] }) => item.exercises)).toEqual(saved.workouts.map((item: { exercises: unknown[] }) => item.exercises));
});
