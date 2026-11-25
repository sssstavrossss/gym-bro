import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-workout-log-${Date.now()}-${test.info().project.name}`;
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

test("A workout: start it, add an exercise, tick off sets, rest, finish, and see it saved", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");

  await page.getByRole("button", { name: "Start", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add exercise" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Search exercises").fill("barbell bench press");
  await sheet.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip" }).click();

  // New to this exercise: three empty sets, no "last time".
  const workout = page.getByRole("dialog", { name: "Workout" });
  const card = workout.locator('[data-workout-exercise="barbell-bench-press-medium-grip"][data-open]');
  await expect(card.getByText("First time")).toBeVisible();
  await expect(card.locator("[data-set]")).toHaveCount(3);

  await card.getByLabel("Set 1, kg").fill("60");
  await card.getByLabel("Set 1, Reps").fill("10");
  await card.getByRole("button", { name: "Set 1 done" }).click();
  await expect(card.getByRole("button", { name: "Set 1 done" })).toHaveAttribute("aria-pressed", "true");
  // The next set offers the same numbers, and ticking it takes them.
  await expect(card.getByLabel("Set 2, kg")).toHaveAttribute("placeholder", "60");
  await card.getByRole("button", { name: "Set 2 done" }).click();
  await expect(workout.locator("[data-workout-status]")).toContainText("2 of 3 sets");

  // A compound press rests 2:00; Skip ends it.
  const rest = workout.locator("[data-rest]");
  await expect(rest.getByRole("timer")).toHaveText(/^(2:00|1:5\d)$/);
  await rest.getByRole("button", { name: "Skip" }).click();
  await expect(rest).toHaveCount(0);

  // Closing keeps it going; Train offers to resume it, also after a reload.
  await workout.getByRole("button", { name: "Hide the workout" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();

  // Finish asks about the set not ticked off, then leaves it out.
  await workout.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(workout.getByRole("alertdialog")).toContainText("1 set isn't ticked off");
  await workout.getByRole("alertdialog").getByRole("button", { name: "Finish", exact: true }).click();

  const done = page.getByRole("dialog", { name: "Workout done" });
  await expect(done.locator("[data-workout-summary]")).toContainText("1,200 kg");
  await expect(done.locator("[data-workout-summary]")).toContainText("60 kg × 10, 10");
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const list = await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) });
  const saved = (await list.json()).workouts;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ exercises: ["barbell-bench-press-medium-grip"], sets: 2, volumeKg: 1200 });

  // Next time, the exercise starts with last time's two sets, shown beside each one.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("dialog", { name: "Add exercise" }).getByLabel("Search exercises").fill("barbell bench press");
  await page.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip" }).click();
  await expect(card.locator("[data-set]")).toHaveCount(2);
  await expect(card.locator("[data-set]").first()).toContainText("60 × 10");

  // The how-to opens over the workout, and Esc goes back to it.
  await card.getByRole("button", { name: "How to do Barbell Bench Press - Medium Grip" }).click();
  await expect(page.getByRole("dialog", { name: "Barbell Bench Press - Medium Grip" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Barbell Bench Press - Medium Grip" })).toHaveCount(0);
  await expect(workout).toBeVisible();

  // Discard throws it away.
  await workout.getByRole("button", { name: "Discard" }).click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
});
