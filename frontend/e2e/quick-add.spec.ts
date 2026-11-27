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
  // Nothing grabs focus, so no keyboard comes up: the search waits for a tap.
  await expect(add.getByLabel("Search exercises")).not.toBeFocused();
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

  // The squat opens on its own screen: one set at a time, logged from the footer.
  await expect(page.locator('[data-exercise-screen][data-workout-exercise="barbell-squat"]')).toBeVisible();
  await page.getByLabel("Set 1, kg").fill("80");
  await page.getByLabel("Set 1, Reps").fill("5");
  await page.getByRole("button", { name: "Log set 1" }).click();
  await expect(page.locator("[data-exercise-status]")).toHaveText("Set 2 of 3");
  await page.locator("[data-exercise-done]").click();

  // The start held: the live header shows it, and the chip opens the same card.
  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  const chip = workout.locator("[data-workout-times-chip]");
  await expect(chip).toHaveText(`${start.time} – now`);

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

test("One set at a time: quick fills, correcting a done set, and one more after the last", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const add = page.getByRole("dialog", { name: "Add exercise" });
  // Only the exercises scroll: the search and both rows of chips stay at the top of the sheet.
  await expect(add.getByRole("button", { name: /^Add / }).nth(12)).toBeVisible();
  const body = add.locator(".sheet-body");
  await body.evaluate((el) => { el.scrollTop = 800; });
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
  // Read both in one go: the sheet may still be sliding up.
  await expect.poll(() => add.evaluate((d) => Math.round(d.querySelector("[data-exercise-head]")!.getBoundingClientRect().top - d.querySelector(".sheet-body")!.getBoundingClientRect().top))).toBe(0);
  await expect(add.getByLabel("Search exercises")).toBeInViewport();
  await add.getByLabel("Search exercises").fill("barbell squat");
  await add.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  const screen = page.locator('[data-exercise-screen][data-workout-exercise="barbell-squat"]');
  const rows = screen.locator("[data-set]");
  const status = page.locator("[data-exercise-status]");
  await expect(status).toHaveText("Set 1 of 3");
  await page.getByLabel("Set 1, kg").fill("100");
  await page.getByLabel("Set 1, Reps").fill("5");
  await page.getByRole("button", { name: "Log set 1" }).click();
  await expect(rows.nth(0)).toContainText("100 × 5");

  // Same as before takes set 1's numbers; +2.5 kg steps up from them.
  await page.locator("[data-same-as]").click();
  await expect(page.getByLabel("Set 2, kg")).toHaveValue("100");
  await page.getByRole("button", { name: "2.5 kg more" }).click();
  await expect(page.getByLabel("Set 2, kg")).toHaveValue("102.5");
  await page.getByRole("button", { name: "Log set 2" }).click();
  await expect(rows.nth(1)).toContainText("102.5 × 5");

  // A done set can be picked and corrected; Next set goes back to the one up next.
  await rows.nth(0).click();
  await expect(status).toHaveText("Editing set 1");
  await page.getByLabel("Set 1, Reps").fill("6");
  await expect(rows.nth(0)).toContainText("100 × 6");
  await page.getByRole("button", { name: "Next set" }).click();
  await expect(status).toHaveText("Set 3 of 3");
  await page.getByRole("button", { name: "Log set 3" }).click();

  // After the last, a log adds one more.
  await expect(status).toHaveText("3 of 3 done · one more?");
  await expect(screen.locator("[data-set-extra]")).toBeVisible();
  await page.getByRole("button", { name: "Log set 4" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("102.5 × 5");

  await page.locator("[data-exercise-done]").click();
  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  await expect(workout.locator('[data-workout-exercise="barbell-squat"]')).toContainText("100 × 6, 102.5 × 5, 102.5 × 5, 102.5 × 5");
  await workout.locator("[data-workout-end-now]").click();
  await page.getByRole("dialog", { name: "Workout done" }).getByRole("button", { name: "Done", exact: true }).click();
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const saved = (await (await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) })).json()).workouts;
  expect(saved[0]).toMatchObject({ exercises: ["barbell-squat"], sets: 4 });
});
