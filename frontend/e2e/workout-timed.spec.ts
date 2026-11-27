import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-timed-${Date.now()}-${test.info().project.name}`;
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

/** A new workout with pull-ups and push-ups done as a superset, on the clock in `format`. */
async function circuit(page: Page, format: string) {
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("pullups");
  await adding.getByRole("button", { name: "Add Pullups", exact: true }).click();
  // Each opens on its own screen; joining the second to the first goes back to the workout.
  await page.getByRole("button", { name: "Back to the workout" }).click();
  const workout = page.getByRole("dialog", { name: "Workout" });
  await workout.getByRole("button", { name: "Exercise", exact: true }).click();
  await adding.getByLabel("Search exercises").fill("pushups");
  await adding.getByRole("button", { name: "Add Pushups", exact: true }).click();
  await page.locator("[data-exercise-screen]").getByRole("button", { name: "Superset with Pullups" }).click();

  await workout.getByRole("group", { name: "Superset: Pullups, Pushups" }).getByRole("button", { name: "Format: Rounds. Change" }).click();
  await workout.getByRole("radiogroup", { name: "Format" }).getByRole("radio", { name: format, exact: true }).click();
  // The block is named for its format now.
  const block = workout.getByRole("group", { name: `${format}: Pullups, Pushups` });
  await block.locator("[data-format-panel]").getByRole("button", { name: "Done", exact: true }).click();
  return { workout, block };
}

async function savedToday(page: Page, oid: string) {
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const list = (await (await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) })).json()).workouts;
  expect(list).toHaveLength(1);
  return { id: list[0].id as string, saved: await (await page.request.get(`/api/workouts/${list[0].id}`, { headers: headers(oid) })).json() };
}

/** Finish, confirming when sets are left unticked. */
async function finish(workout: ReturnType<Page["getByRole"]>, unticked: boolean) {
  await workout.getByRole("button", { name: /^End now/ }).click();
  if (unticked) await workout.getByRole("alertdialog").getByRole("button", { name: "End workout" }).click();
}

test("an AMRAP counts its rounds, takes the extra reps, and keeps its score", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  const { workout, block } = await circuit(page, "AMRAP");
  await expect(block.locator("[data-run-heading]")).toHaveText("AMRAP 12 min · as many rounds as you can");

  const clock = block.locator("[data-block-clock]");
  await expect(clock).toHaveAttribute("data-phase", "ready");
  await expect(clock.getByRole("timer")).toHaveText("12:00");
  await block.getByRole("button", { name: "Start", exact: true }).click();
  await expect(clock).toHaveAttribute("data-phase", "running");
  // The format is set once the clock runs.
  await expect(block.locator("[data-block-format]")).toHaveCount(0);
  await block.getByRole("button", { name: "Round done" }).click();
  await block.getByRole("button", { name: "Round done" }).click();
  await expect(clock).toContainText("2 rounds so far");
  // A clocked block has no rest between rounds.
  await expect(workout.locator("[data-rest]")).toHaveCount(0);

  await block.getByRole("button", { name: "Stop", exact: true }).click();
  const score = block.locator("[data-block-score]");
  await expect(score).toBeVisible();
  await score.getByRole("button", { name: "One extra rep more" }).click();
  await score.getByRole("button", { name: "One extra rep more" }).click();
  await expect(score.locator("[data-block-score-line]")).toHaveText("AMRAP 12 min · 2 rounds + 2 reps");

  // Each exercise's third set is left: the AMRAP ran out first.
  await finish(workout, true);
  const done = page.getByRole("dialog", { name: "Workout done" });
  await expect(done.locator("[data-summary-score]")).toHaveText("AMRAP 12 min · 2 rounds + 2 reps");
  await done.getByRole("button", { name: "Done", exact: true }).click();

  const { id, saved } = await savedToday(page, oid);
  expect(saved.blocks).toEqual([{ block: 0, format: "amrap", minutes: 12, every: null, rounds: 2, reps: 2, seconds: null }]);

  // Opened again from the history, the block shows its score.
  await page.locator(`[data-workout-row="${id}"]`).click();
  const sheet = page.getByRole("dialog", { name: "Edit workout" });
  await expect(sheet.locator("[data-block-score-line]")).toHaveText("AMRAP 12 min · 2 rounds + 2 reps");
  await expect(sheet.locator("[data-block-clock]")).toHaveCount(0);
});

test("for time stops the clock at the last round and saves the time", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  const { workout, block } = await circuit(page, "For time");
  const clock = block.locator("[data-block-clock]");
  await expect(clock).toContainText("3 rounds as fast as you can");
  await block.getByRole("button", { name: "Start", exact: true }).click();
  await expect(clock).toContainText("Round 1 of 3");
  for (let round = 0; round < 3; round++) await block.getByRole("button", { name: "Round done" }).click();

  await expect(clock).toHaveCount(0);
  await expect(block.locator("[data-block-score-line]")).toHaveText(/^For time · 0:\d\d$/);
  await finish(workout, false);
  await page.getByRole("dialog", { name: "Workout done" }).getByRole("button", { name: "Done", exact: true }).click();

  const { saved } = await savedToday(page, oid);
  expect(saved.blocks).toHaveLength(1);
  expect(saved.blocks[0]).toMatchObject({ block: 0, format: "for_time", minutes: null, rounds: null });
  expect(saved.blocks[0].seconds).toBeGreaterThanOrEqual(0);
});

test("an EMOM gives each exercise a set for every round", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  const { block } = await circuit(page, "EMOM");
  await expect(block.locator("[data-run-heading]")).toHaveText("EMOM 10 min · a round each minute");
  await expect(block.locator('[data-workout-exercise="pullups"] [data-set]')).toHaveCount(10);
  await expect(block.locator("[data-block-clock]")).toContainText("10 rounds, one each minute");
  await block.getByRole("button", { name: "Start", exact: true }).click();
  await expect(block.locator("[data-block-clock]")).toContainText("Round 1 of 10");
});
