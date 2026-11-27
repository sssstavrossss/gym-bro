import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
  const oid = `e2e-bests-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const day = 86_400_000;
    return { zone, today: format(new Date()), days: [format(new Date(Date.now() - 4 * day)), format(new Date(Date.now() - 2 * day))] };
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
  return { oid, ...when };
}

const set = (exerciseId: string, kg: number, reps: number, rir: number) => ({ exerciseId, block: 0, type: "working", kg, reps, rir, doneAt: new Date().toISOString() });

test("beating an exercise's best estimated max says so on the card and in the summary", async ({ page }) => {
  await page.goto("/");
  const { oid, zone, days } = await setup(page);
  const weekday = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const made = await page.request.put("/api/plan", {
    headers: headers(oid),
    data: { goal: "muscle", weekdays: [0, 1, 2, 3].map((n) => (weekday + n) % 7).sort((a, b) => a - b), minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], timeZone: "UTC" },
  });
  expect(made.status(), await made.text()).toBe(201);

  // The best so far: 60 × 10 at 2 in reserve, an estimated max of 84 kg.
  const bench = "barbell-bench-press-medium-grip";
  const saved = await page.request.put(`/api/workouts/${crypto.randomUUID()}`, {
    headers: headers(oid),
    data: { date: days[1], timeZone: zone, kind: "strength", status: "done", sets: [set(bench, 60, 10, 2), set(bench, 50, 12, 4)] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  await page.goto("/train");
  await page.locator("[data-up-next]").getByRole("button", { name: "Start Upper A" }).click();
  const workout = page.getByRole("dialog", { name: "Upper A" });
  const card = workout.locator(`[data-workout-exercise="${bench}"][data-open]`);
  await expect(card.locator("[data-load-suggestion]")).toBeVisible();
  await card.getByLabel("Set 1, kg").fill("60");
  await card.getByLabel("Set 1, Reps").fill("10");
  await card.getByLabel("Set 1, RIR").fill("2");
  await card.getByRole("button", { name: "Set 1 done" }).click();
  // Equal isn't a record.
  await expect(card.locator("[data-new-best]")).toHaveCount(0);

  await card.getByLabel("Set 2, kg").fill("70");
  await card.getByLabel("Set 2, Reps").fill("8");
  await card.getByLabel("Set 2, RIR").fill("2");
  await card.getByRole("button", { name: "Set 2 done" }).click();
  await expect(card.locator("[data-new-best]")).toHaveText("New best: est. max 93.5 kg");

  await workout.getByRole("button", { name: /^End now/ }).click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "End workout" }).click();
  const summary = page.getByRole("dialog", { name: "Workout done" });
  await expect(summary.locator("[data-bests-count]")).toHaveText("1 new best");
  await expect(summary.locator("[data-new-best]")).toHaveText("New best: est. max 93.5 kg, up 9.5");

  const previous = await (await page.request.get(`/api/workouts/previous?exercise=${bench}`, { headers: headers(oid) })).json();
  expect(previous.exercises[bench].best).toMatchObject({ kg: 70, reps: 8, rir: 2, estimatedMax: 93.33 });
});
