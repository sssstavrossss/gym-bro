import { expect, test, type Page } from "@playwright/test";
import { pick, setRow } from "./dial";
import { addToWorkout, menu } from "./timeline";

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

test("Quick start: the workout starts now on its timeline, an empty one closes to nothing, and one done earlier gets its own times", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");
  await expect(page.locator("[data-start-workout]")).toContainText("Quick start");

  // + starts the workout now and opens it on its timeline, empty: its clock runs, with + Exercise and End.
  await page.getByRole("button", { name: "Empty workout" }).click();
  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  const chip = workout.locator("[data-workout-times-chip]");
  await expect(chip).toHaveText(/\d{2}:\d{2} – now$/);
  await expect(workout.getByText(/^Started \d{2}:\d{2}$/)).toBeVisible();
  await expect(workout.locator("[data-workout-end-now]")).toBeVisible();
  // + Exercise opens Add exercise; nothing grabs focus there, so no keyboard comes up. ← goes back to the workout.
  await addToWorkout(page, "add-exercise");
  const add = page.getByRole("dialog", { name: "Add exercise" });
  await expect(add.getByLabel("Search exercises")).not.toBeFocused();
  await add.getByRole("button", { name: "Back to the workout" }).click();
  await expect(workout.locator("[data-timeline-add]")).toBeVisible();
  // Hidden with nothing added, it goes quietly: Train shows Quick start again, not a workout in progress.
  await workout.getByRole("button", { name: "Hide the workout" }).click();
  await expect(workout).toHaveCount(0);
  await expect(page.locator("[data-workout-card]")).toHaveCount(0);
  await expect(page.locator("[data-start-workout]")).toBeVisible();

  // Again, this time moving the start back 90 minutes before adding anything.
  await page.getByRole("button", { name: "Empty workout" }).click();
  await chip.click();
  const live = workout.locator("[data-workout-times]");
  const [start, end, later] = await local(page, -90, -30, 30);
  await live.getByLabel("Day it started").fill(start.day);
  await live.getByLabel("Time it started").fill(start.time);
  await expect(chip).toHaveText(`${start.time} – now`);
  await addToWorkout(page, "add-exercise");
  await add.getByLabel("Search exercises").fill("barbell squat");
  await add.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  // The squat opens on the timeline, on its first set to do.
  await expect(setRow(workout, "barbell-squat", 0)).toHaveAttribute("data-set-state", "now");
  await pick(page, workout.getByLabel("Set 1, kg"), 80);
  await pick(page, workout.getByLabel("Set 1, Reps"), 5);
  await workout.getByRole("button", { name: "Set 1 done" }).click();
  await expect(setRow(workout, "barbell-squat", 1)).toHaveAttribute("data-set-state", "now");

  // The start held, and the chip opens the same card.
  await expect(chip).toHaveText(`${start.time} – now`);

  // It ended an hour after it started: End says when, and saves that.
  await chip.click();
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

test("The timeline: the set to do, numbers that carry on, a done set corrected, and one more after the last", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  await addToWorkout(page, "add-exercise");
  const add = page.getByRole("dialog", { name: "Add exercise" });
  // Only the exercises scroll, like Add food: the sheet itself has nothing to scroll, and each muscle group's page
  // scrolls on its own under the search and both rows of chips.
  await expect(add.getByRole("button", { name: /^Add / }).nth(12)).toBeVisible();
  // Measured from the sheet body in one go, since the sheet may still be sliding up.
  const headOffset = () => add.evaluate((d) => Math.round(d.querySelector("[data-exercise-head]")!.getBoundingClientRect().top - d.querySelector(".sheet-body")!.getBoundingClientRect().top));
  const top = await headOffset();
  const sheetBody = await add.locator(".sheet-body").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(sheetBody.scroll, "the sheet scrolls, dragging the search and chips with it").toBeLessThanOrEqual(sheetBody.client);
  const allPage = add.locator('[data-exercise-page="all"]');
  await allPage.evaluate((el) => { el.scrollTop = 800; });
  await expect.poll(() => allPage.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
  expect(await headOffset()).toBe(top);
  await expect(add.getByLabel("Search exercises")).toBeInViewport();
  await add.getByLabel("Search exercises").fill("barbell squat");
  await add.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  const workout = page.getByRole("dialog", { name: "Workout", exact: true });
  const squat = (index: number) => setRow(workout, "barbell-squat", index);
  await expect(squat(0)).toHaveAttribute("data-set-state", "now");
  await expect(squat(2)).toHaveAttribute("data-set-state", "next");

  // A number picked for the set to do carries on to the sets after it.
  await pick(page, squat(0).getByLabel("Set 1, kg"), 100);
  await pick(page, squat(0).getByLabel("Set 1, Reps"), 5);
  await expect(squat(2).getByLabel("Set 3, kg")).toHaveText(/^100\s?kg$/);
  await workout.getByRole("button", { name: "Set 1 done" }).click();
  await expect(squat(0)).toHaveAttribute("data-done", "");
  await expect(squat(0).getByLabel("Set 1, Reps")).toHaveText("5");
  // Logging starts the rest, on the rail before the next set; its ✓ ends it.
  await expect(workout.locator("[data-rest]")).toBeVisible();
  await workout.locator("[data-rest-skip]").click();
  await expect(workout.locator("[data-rest]")).toHaveCount(0);

  // Stepping up on set 2 takes set 3 with it, not set 1.
  await expect(squat(1)).toHaveAttribute("data-set-state", "now");
  await pick(page, squat(1).getByLabel("Set 2, kg"), 102.5);
  await expect(squat(2).getByLabel("Set 3, kg")).toHaveText(/^102.5\s?kg$/);
  await workout.getByRole("button", { name: "Set 2 done" }).click();

  // A done set is corrected in place, and nothing else changes.
  await pick(page, squat(0).getByLabel("Set 1, Reps"), 6);
  await expect(squat(0).getByLabel("Set 1, Reps")).toHaveText("6");
  // Set 3 is the set to do now: the same line, a touch bigger, with its ✓.
  await expect(squat(2).getByLabel("Set 3, Reps")).toHaveText("5");
  await expect(squat(2).locator("[data-log-set]")).toBeVisible();

  // A done set's node on the rail unticks it, and ticks it again.
  const node = workout.locator('[data-set-node="barbell-squat-1"]');
  await node.click();
  await expect(squat(1)).toHaveAttribute("data-set-state", "now");
  await expect(squat(2)).not.toHaveAttribute("data-set-state", "now");
  await node.click();
  await expect(squat(1)).toHaveAttribute("data-done", "");
  await workout.locator("[data-rest-skip]").click();

  // Held, a set opens its menu: Duplicate adds the same numbers after it, Delete takes it out, with Undo.
  // A hold never selects text (iOS selected the whole sheet behind the menu): not on the list, nor anywhere while it's open.
  expect(await squat(2).evaluate((row) => !row.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true })))).toBe(true);
  await squat(2).click({ button: "right" });
  await expect(menu(page).locator('[data-menu-item="delete"]')).toBeEnabled();
  expect(await page.locator("[data-menu-scrim]").evaluate((scrim) => !scrim.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true })))).toBe(true);
  await page.evaluate(() => window.getSelection()?.selectAllChildren(document.body));
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true);
  await menu(page).locator('[data-menu-item="duplicate"]').click();
  await expect(workout.locator('[data-set][data-exercise="barbell-squat"]')).toHaveCount(4);
  await expect(squat(3).getByLabel("Set 4, kg")).toHaveText(/^102.5\s?kg$/);
  await squat(3).click({ button: "right" });
  await menu(page).locator('[data-menu-item="delete"]').click();
  await expect(workout.locator('[data-set][data-exercise="barbell-squat"]')).toHaveCount(3);
  await page.locator(".toast.front").filter({ hasText: "Set 4 deleted" }).getByRole("button", { name: "Undo" }).click();
  await expect(workout.locator('[data-set][data-exercise="barbell-squat"]')).toHaveCount(4);
  await squat(3).click({ button: "right" });
  await menu(page).locator('[data-menu-item="delete"]').click();
  await expect(workout.locator('[data-set][data-exercise="barbell-squat"]')).toHaveCount(3);
  await workout.getByRole("button", { name: "Set 3 done" }).click();

  // Done, it folds to its heading. The timeline's + adds a set to it, offering the set before's numbers.
  const heading = workout.locator('[data-workout-exercise="barbell-squat"]');
  await expect(heading).not.toHaveAttribute("data-open");
  await addToWorkout(page, "add-set");
  await expect(heading).toHaveAttribute("data-open", "");
  await expect(squat(3)).toHaveAttribute("data-set-state", "now");
  await expect(squat(3).getByLabel("Set 4, kg")).toHaveText(/^102.5\s?kg$/);
  await workout.getByRole("button", { name: "Set 4 done" }).click();
  await expect(heading).toContainText("100 × 6, 102.5 × 5, 102.5 × 5, 102.5 × 5");
  await expect(heading).not.toHaveAttribute("data-open");
  await workout.locator("[data-workout-end-now]").click();
  await page.getByRole("dialog", { name: "Workout done" }).getByRole("button", { name: "Done", exact: true }).click();
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const saved = (await (await page.request.get(`/api/workouts?from=${today}&to=${today}`, { headers: headers(oid) })).json()).workouts;
  expect(saved[0]).toMatchObject({ exercises: ["barbell-squat"], sets: 4 });
});
