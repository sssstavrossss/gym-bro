import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-hyrox-${Date.now()}-${test.info().project.name}`;
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

test("a Hyrox plan: strength days between station circuits and runs, and Stations A runs for time", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");

  const make = page.locator("[data-plan-card]");
  await make.getByRole("radiogroup", { name: "Goal" }).getByRole("radio", { name: "Hyrox" }).click();
  await expect(make.locator("[data-plan-stats]")).toContainText("Hyrox");
  await make.locator("[data-see-plan]").click();
  const sheet = page.getByRole("dialog", { name: "New plan" });
  await settled(sheet);
  await expect(sheet.locator("[data-plan-new-workout]")).toHaveText([/^Strength A/, /^Stations A/, /^Runs A/, /^Strength B/, /^Stations B/, /^Runs B/]);
  // Three days take the first three; the rest come the week after.
  await expect(sheet.locator('[data-plan-new-workout="Strength B"]')).toContainText("From week 2");
  // Hyrox has its own split; the others aren't offered.
  await sheet.getByRole("button", { name: "Change split" }).click();
  const splits = sheet.getByRole("radiogroup", { name: "Split" }).getByRole("radio");
  await expect(splits).toHaveText(["Your own", "Hyrox"]);
  await sheet.locator("[data-plan-save]").click();
  await expect(sheet).toBeHidden();

  const card = page.locator("[data-plan-card]");
  await expect(card).toContainText("Hyrox · 3 days · 60 min");
  await expect(card.locator('[data-plan-workout="Stations A"]')).toContainText("5 exercises · 3 rounds");
  await expect(card.locator('[data-plan-workout="Stations A"]')).toContainText("Run · SkiErg · Sled Push · Sled Pull · Burpee Broad Jump");
  await expect(card.locator('[data-plan-workout="Runs B"]')).toContainText("1 exercise · ");

  const saved = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan;
  expect(saved.split).toBe("hyrox");
  expect(saved.workouts[1].exercises[0]).toMatchObject({ exerciseId: "run", metres: 1000, format: "for_time", superset: false });
  expect(saved.workouts[1].exercises[1]).toMatchObject({ exerciseId: "skierg", metres: 500, superset: true });

  // Skip Strength A: Stations A is up next, a circuit on the clock with each station's distance to cover.
  const next = page.locator("[data-up-next]");
  await next.getByRole("button", { name: "Skip Strength A" }).click();
  await expect(next).toContainText("Stations A");
  // A circuit on the clock has no reps in reserve.
  await expect(next).toContainText("Week 1 of 6");
  await expect(next).not.toContainText("in reserve");
  await next.getByRole("button", { name: "Start Stations A" }).click();
  const workout = page.getByRole("dialog", { name: "Stations A" });
  const block = workout.getByRole("group", { name: "For time: Run, SkiErg, Sled Push, Sled Pull, Burpee Broad Jump" });
  await expect(block.locator("[data-block-clock]")).toContainText("3 rounds as fast as you can");
  const run = workout.locator('[data-workout-exercise="run"]');
  await expect(run).toContainText("1 km");
  await expect(run.locator("[data-set]")).toHaveCount(3);
  await expect(run.getByLabel("Set 1, m", { exact: true })).toHaveAttribute("placeholder", "1000");

  await block.getByRole("button", { name: "Start", exact: true }).click();
  await expect(block.locator("[data-block-clock]")).toContainText("Round 1 of 3");
  for (let round = 0; round < 3; round++) await block.getByRole("button", { name: "Round done" }).click();
  await expect(block.locator("[data-block-score-line]")).toHaveText(/^For time · 0:\d\d$/);
});
