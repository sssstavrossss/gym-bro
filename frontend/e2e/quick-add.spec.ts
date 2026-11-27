import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-quick-add-${Date.now()}-${test.info().project.name}`;
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


/** Clock times and their calendar days on the device, each so many minutes from now, read in one go. */
async function local(page: Page, ...offsets: number[]) {
  return page.evaluate((list) => {
    const base = Date.now() - (Date.now() % 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return list.map((offset) => {
      const at = new Date(base + offset * 60_000);
      return { day: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
    });
  }, offsets);
}

test("Quick add: the start waits for the first exercise, an empty workout closes to nothing, and one done earlier gets its own times", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");
  await expect(page.locator("[data-start-workout]")).toContainText("Quick add");

  // + opens the picker with the times chip at "Now"; × closes it and nothing was started.
  await page.getByRole("button", { name: "Empty workout" }).click();
  const add = page.getByRole("dialog", { name: "Add exercise" });
  await expect(add.getByRole("button", { name: "Times: starts now" })).toHaveText("Now");
  await add.getByRole("button", { name: "Close" }).click();
  await expect(add).toHaveCount(0);
  await expect(page.locator("[data-workout-card]")).toHaveCount(0);
  await expect(page.locator("[data-start-workout]")).toBeVisible();

  // Again, this time moving the start back 90 minutes before adding anything.
  await page.getByRole("button", { name: "Empty workout" }).click();
  await add.getByRole("button", { name: "Times: starts now" }).click();
  const times = add.locator("[data-workout-times]");
  const [start, end, later] = await local(page, -90, -30, 30);
  await times.getByLabel("Day it started").fill(start.day);
  await times.getByLabel("Time it started").fill(start.time);
  await expect(add.getByRole("button", { name: "Times: starts now" })).toHaveText(`${start.time} – now`);
  await add.getByLabel("Search exercises").fill("barbell squat");
  await add.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  // The start held: the live header shows it, and the chip opens the same card.
  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  const chip = workout.locator("[data-workout-times-chip]");
  await expect(chip).toHaveText(`${start.time} – now`);
  const card = workout.locator('[data-workout-exercise="barbell-squat"][data-open]');
  await card.getByLabel("Set 1, kg").fill("80");
  await card.getByLabel("Set 1, Reps").fill("5");
  await card.getByRole("button", { name: "Set 1 done" }).click();

  // It ended an hour after it started: End says when, and saves that.
  await chip.click();
  const live = workout.locator("[data-workout-times]");
  await live.getByRole("radio", { name: "At a time" }).click();
  await live.getByLabel("Time it ended").fill(end.time);
  await expect(chip).toHaveText(`${start.time} – ${end.time}`);
  const endNow = workout.locator("[data-workout-end-now]");
  await expect(endNow).toHaveText(`End at ${end.time}`);

  // A time later than now is refused, and the workout keeps what it had.
  await live.getByLabel("Time it ended").fill(later.time);
  await expect(live.locator("[data-times-problem]")).toHaveText(/later than now|after the start/);
  await expect(endNow).toHaveText(`End at ${end.time}`);
  await live.getByLabel("Time it ended").fill(end.time);

  await endNow.click();
  await workout.getByRole("alertdialog").getByRole("button", { name: "End workout" }).click();
  await page.getByRole("dialog", { name: "Workout done" }).getByRole("button", { name: "Done", exact: true }).click();

  const list = await page.request.get(`/api/workouts?from=${start.day}&to=${end.day}`, { headers: headers(oid) });
  const rows = (await list.json()).workouts;
  expect(rows).toHaveLength(1);
  const saved = await (await page.request.get(`/api/workouts/${rows[0].id}`, { headers: headers(oid) })).json();
  expect(saved.date).toBe(start.day);
  expect(Math.round((Date.parse(saved.endedAt) - Date.parse(saved.startedAt)) / 60_000)).toBe(60);
});
