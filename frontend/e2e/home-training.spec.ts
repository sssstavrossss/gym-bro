import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-home-training-${Date.now()}-${test.info().project.name}`;
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

async function putPlan(page: Page, oid: string, weekdays: number[]) {
  const response = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "muscle", weekdays, minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], timeZone: "UTC" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("Today's training card: rest day, today's workout, in progress, skipped, and switched off", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  const { weekday, today } = await page.evaluate(() => ({
    weekday: (new Date().getDay() + 6) % 7,
    today: new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
  }));
  const days = (from: number) => [0, 1, 2, 3].map((n) => (weekday + from + n) % 7).sort((a, b) => a - b);
  const card = page.locator("[data-training-today]");

  // No plan: no card.
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();
  await expect(card).toHaveCount(0);

  // Training days from tomorrow: a rest day, with the next one.
  await putPlan(page, oid, days(1));
  await page.reload();
  await expect(card).toHaveAttribute("data-training-today", "rest");
  await expect(card).toContainText("Rest day");
  await expect(card).toContainText("Next: Upper A · Tomorrow");

  // A training day today: Start opens the plan workout; hiding it shows it running.
  const plan = await putPlan(page, oid, days(0));
  await page.reload();
  await expect(card).toHaveAttribute("data-training-today", "today");
  await expect(card).toContainText("Upper A");
  await expect(card).toContainText("Week 1 of 6 · 3 reps in reserve");
  await card.getByRole("button", { name: "Start Upper A" }).click();
  const workout = page.getByRole("dialog", { name: "Upper A" });
  await expect(workout).toBeVisible();
  await workout.getByRole("button", { name: "Hide the workout" }).click();
  await expect(card).toHaveAttribute("data-training-today", "running");
  await expect(card).toContainText("Upper A in progress");
  await card.getByRole("button", { name: "Resume" }).click();
  await workout.getByRole("button", { name: "Discard" }).click();
  await expect(card).toHaveAttribute("data-training-today", "today");

  // Skipped today (from Train or elsewhere): the card says so, with the next one.
  const skipped = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
    headers: headers(oid),
    data: { date: today, timeZone: "UTC", name: "Upper A", status: "skipped", planWorkoutId: plan.workouts[0].id, sequencePosition: 0 },
  });
  expect(skipped.ok(), await skipped.text()).toBeTruthy();
  await page.reload();
  await expect(card).toHaveAttribute("data-training-today", "done");
  await expect(card).toContainText("Upper A · skipped");
  await expect(card).toContainText("Next: Lower A · Tomorrow");

  // Settings → Home sections → Training switches it off.
  expect((await page.request.put("/api/profile/settings", { headers: headers(oid), data: { homeHidden: ["training"] } })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("region", { name: "Today's macros" })).toBeVisible();
  await expect(card).toHaveCount(0);
});
