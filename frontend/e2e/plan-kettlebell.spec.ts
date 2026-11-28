import { expect, test, type Page } from "@playwright/test";
import { closeMenu, exerciseMenu } from "./timeline";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-kettlebell-${Date.now()}-${test.info().project.name}`;
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

test("a kettlebell plan ends each workout with a finisher on the clock", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  // Today and every other day after it, so the plan starts today.
  const weekday = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const weekdays = [0, 2, 4].map((n) => (weekday + n) % 7).sort((a, b) => a - b);
  const made = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "fitness", weekdays, minutes: 45, experience: "some", equipment: ["kettlebells"], goEasy: [], timeZone: "UTC" },
  });
  expect(made.status(), await made.text()).toBe(201);
  const [a, b] = (await made.json()).workouts as { exercises: { exerciseId: string; format?: string; minutes?: number; superset?: boolean }[] }[];
  const emom = a.exercises.find((item) => item.format)!;
  expect(emom).toMatchObject({ exerciseId: "kettlebell-swing", format: "emom", minutes: 10 });
  expect(b.exercises.find((item) => item.format)).toMatchObject({ format: "amrap", minutes: 8 });

  await page.goto("/train");
  const card = page.locator("[data-plan-card]");
  await expect(card.locator('[data-plan-workout="Full body A"]')).toContainText("sets + EMOM 10 min · ~45 min");
  await expect(card.locator('[data-plan-workout="Full body B"]')).toContainText("sets + AMRAP 8 min");

  // Started, the finisher is a swing and push-up EMOM: a set each minute, no reps in reserve.
  await page.locator("[data-up-next]").getByRole("button", { name: "Start Full body A" }).click();
  const workout = page.getByRole("dialog", { name: "Full body A" });
  const block = workout.getByRole("group", { name: "EMOM: Kettlebell Swing, Pushups" });
  await expect(block.locator("[data-run-heading]")).toHaveText("EMOM 10 min · a round each minute");
  await expect(block.locator("[data-block-clock]")).toContainText("10 rounds, one each minute");
  await workout.locator('[data-workout-exercise="pushups"]').getByRole("button").first().click();
  const pushups = (await exerciseMenu(page, "pushups")).locator('[data-info="pushups"]');
  await expect(pushups).toContainText("5 reps");
  await expect(pushups).not.toContainText("in reserve");
  await closeMenu(page);
  await expect(workout.locator('[data-set][data-exercise="pushups"]')).toHaveCount(10);
  await block.getByRole("button", { name: "Start", exact: true }).click();
  await expect(block.locator("[data-block-clock]")).toContainText("Round 1 of 10");
});
