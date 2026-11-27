import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-superset-${Date.now()}-${test.info().project.name}`;
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

test("two exercises done as a superset rest after each round and save as one block", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("barbell bench press");
  await adding.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Workout" });
  const bench = workout.locator('[data-workout-exercise="barbell-bench-press-medium-grip"]');
  // The first exercise has nothing before it to join.
  await expect(page.locator("[data-exercise-screen]")).toBeVisible();
  await expect(bench.locator("[data-superset-prev]")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to the workout" }).click();
  await workout.getByRole("button", { name: "Exercise", exact: true }).click();
  await adding.getByLabel("Search exercises").fill("bent over barbell row");
  await adding.getByRole("button", { name: "Add Bent Over Barbell Row", exact: true }).click();

  // On its own screen the second joins the first, and the workout shows them together.
  await page.locator("[data-exercise-screen]").getByRole("button", { name: "Superset with Barbell Bench Press - Medium Grip" }).click();
  const row = workout.locator('[data-workout-exercise="bent-over-barbell-row"][data-open]');
  const join = row.getByRole("button", { name: "Superset with Barbell Bench Press - Medium Grip" });
  await expect(join).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Superset: Barbell Bench Press - Medium Grip + Bent Over Barbell Row")).toBeVisible();
  const group = workout.getByRole("group", { name: "Superset: Barbell Bench Press - Medium Grip, Bent Over Barbell Row" });
  await expect(group).toContainText("Superset · rest after each round");
  // Both open together, so the sets go in turn.
  await expect(group.locator("[data-workout-exercise][data-open]")).toHaveCount(2);

  const openBench = group.locator('[data-workout-exercise="barbell-bench-press-medium-grip"]');
  await openBench.getByLabel("Set 1, kg", { exact: true }).fill("60");
  await openBench.getByLabel("Set 1, Reps", { exact: true }).fill("8");
  await openBench.getByRole("button", { name: "Set 1 done" }).click();
  const rest = workout.locator("[data-rest]");
  await expect(rest).toHaveCount(0);
  await row.getByLabel("Set 1, kg", { exact: true }).fill("50");
  await row.getByLabel("Set 1, Reps", { exact: true }).fill("10");
  await row.getByRole("button", { name: "Set 1 done" }).click();
  await expect(rest.getByRole("timer")).toBeVisible();
  // The next round's first set ends the rest: there's none between the two.
  await openBench.getByRole("button", { name: "Set 2 done" }).click();
  await expect(rest).toHaveCount(0);

  await workout.getByRole("button", { name: /^End now/ }).click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "End workout" }).click();
  await page.getByRole("dialog", { name: "Workout done" }).getByRole("button", { name: "Done", exact: true }).click();

  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const list = (await (await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) })).json()).workouts;
  expect(list).toHaveLength(1);
  const saved = await (await page.request.get(`/api/workouts/${list[0].id}`, { headers: headers(oid) })).json();
  expect(saved.sets.map((set: { exerciseId: string; block: number }) => [set.exerciseId, set.block])).toEqual([
    ["barbell-bench-press-medium-grip", 0], ["barbell-bench-press-medium-grip", 0], ["bent-over-barbell-row", 0],
  ]);

  // Opened again from the history, it is still a superset, and can be split.
  await page.locator(`[data-workout-row="${list[0].id}"]`).click();
  const sheet = page.getByRole("dialog", { name: "Edit workout" });
  const pastGroup = sheet.locator("[data-superset]");
  await expect(pastGroup).toHaveCount(1);
  await sheet.getByRole("button", { name: "Superset with Barbell Bench Press - Medium Grip" }).click();
  await expect(pastGroup).toHaveCount(0);
  await expect(page.getByText("Split Barbell Bench Press - Medium Grip and Bent Over Barbell Row")).toBeVisible();
});
