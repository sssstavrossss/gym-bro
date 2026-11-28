import { expect, test, type Locator, type Page } from "@playwright/test";
import { pick, setRow } from "./dial";
import { addToWorkout, closeMenu, exerciseMenu, fromExerciseMenu, menu } from "./timeline";

// Dragging sets on the workout timeline (README, *Logging a workout*; docs/training.md, decision 15).

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<void> {
  const oid = `e2e-drag-${Date.now()}-${test.info().project.name}`;
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
}

/**
 * Holds `from` until it lifts, then moves it to `at` (0 top, 1 bottom) of `to`, aiming again as the rows move to
 * make room, and lets go unless `keep`.
 */
async function drag(page: Page, from: Locator, to: Locator, at: number, keep = false): Promise<void> {
  const start = (await from.boundingBox())!;
  const x = start.x + 100;
  await page.mouse.move(x, start.y + start.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  for (let n = 0; n < 4; n++) {
    const box = (await to.boundingBox())!;
    await page.mouse.move(x, box.y + box.height * at, { steps: 6 });
    await page.waitForTimeout(150);
  }
  if (!keep) await page.mouse.up();
}

/** An exercise's sets as their weights, warm-ups marked w and drop sets d: "w20 60 70". */
function weights(page: Page, exerciseId: string): Promise<string> {
  return page.locator(`[data-timeline] [data-set][data-exercise="${exerciseId}"]`).evaluateAll((rows) => rows.map((row) => {
    const kg = row.querySelector('[data-cell$="-kg"] .n')?.textContent?.trim() ?? "";
    const name = row.querySelector('[data-cell$="-kg"]')?.getAttribute("aria-label") ?? "";
    return `${name.startsWith("Warm-up") ? "w" : name.startsWith("Drop") ? "d" : ""}${kg}`;
  }).join(" "));
}

test("sets drag into place: reordered at once with Undo, asked about where they'd change, kept in order once done", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const workout = page.getByRole("dialog", { name: "Workout" });
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await addToWorkout(page, "add-exercise");
  await adding.getByLabel("Search exercises").fill("barbell bench press");
  await adding.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip", exact: true }).click();
  const bench = "barbell-bench-press-medium-grip";
  const benchSets = workout.locator(`[data-timeline] [data-set][data-exercise="${bench}"]`);
  await expect(benchSets.first()).toBeVisible();
  for (let count = await benchSets.count(); count < 3; count++) {
    await addToWorkout(page, "add-set");
    await expect(benchSets).toHaveCount(count + 1);
  }
  // 60, 70, 80: each number picked carries on to the sets after it.
  await pick(page, setRow(workout, bench, 0).getByLabel("Set 1, kg", { exact: true }), 60);
  await pick(page, setRow(workout, bench, 1).getByLabel("Set 2, kg", { exact: true }), 70);
  await pick(page, setRow(workout, bench, 2).getByLabel("Set 3, kg", { exact: true }), 80);
  await expect.poll(() => weights(page, bench)).toBe("60 70 80");

  // Held and let go where it was: the set's menu, as before.
  await drag(page, setRow(workout, bench, 1), setRow(workout, bench, 1), 0.5);
  await expect(menu(page).locator('[data-menu-item="duplicate"]')).toBeVisible();
  await closeMenu(page);

  // Dragged to the top: it's there at once, and Undo puts it back. Nothing selects on the way.
  await drag(page, setRow(workout, bench, 2), setRow(workout, bench, 0), 0.1);
  await expect.poll(() => weights(page, bench)).toBe("80 60 70");
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true);
  await page.locator(".toast.front").filter({ hasText: "Set moved" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => weights(page, bench)).toBe("60 70 80");

  // Above a warm-up, a working set would become one: the note says so on the way, and the drop asks.
  await addToWorkout(page, "add-warmup");
  const warmups = (await weights(page, bench)).split(" ").filter((each) => each.startsWith("w")).length;
  expect(warmups).toBeGreaterThan(0);
  await drag(page, setRow(workout, bench, warmups + 2), setRow(workout, bench, 0), 0.1, true);
  await expect(page.locator("[data-drag-note]")).toContainText("Make 80 kg a warm-up?");
  await page.mouse.up();
  const ask = page.locator("[data-move-ask]");
  await expect(ask).toContainText("a warm-up?");
  await expect(ask).toContainText("Warm-ups don't count toward your sets, volume or bests.");
  // The change shows behind the question; Put it back undoes it.
  await expect.poll(() => weights(page, bench)).toMatch(/^w80 /);
  await menu(page).locator('[data-menu-item="move-back"]').click();
  await expect.poll(() => weights(page, bench)).toMatch(/ 60 70 80$/);
  await expect(page.locator("[data-move-ask]")).toHaveCount(0);

  // A done set keeps its place: dragged, nothing moves, and the reason shows.
  await workout.locator(`[data-set-node="${bench}-0"]`).click();
  await workout.locator("[data-rest-skip]").click();
  await drag(page, setRow(workout, bench, 0), setRow(workout, bench, warmups + 1), 0.6, true);
  await expect(page.locator("[data-drag-note]")).toContainText("Sets you've done stay in the order you did them.");
  await page.mouse.up();
  await expect(page.locator(".toast").filter({ hasText: "Sets you've done stay in the order you did them." })).toBeVisible();
  expect((await weights(page, bench)).split(" ").slice(-3).join(" ")).toBe("60 70 80");

  // Into another exercise: asked first, then it's that exercise's set.
  await addToWorkout(page, "add-exercise");
  await adding.getByLabel("Search exercises").fill("barbell incline bench press");
  await adding.getByRole("button", { name: "Add Barbell Incline Bench Press - Medium Grip", exact: true }).click();
  const incline = "barbell-incline-bench-press-medium-grip";
  await expect(workout.locator(`[data-set][data-exercise="${incline}"]`).first()).toBeVisible();
  const inclineSets = await workout.locator(`[data-set][data-exercise="${incline}"]`).count();
  await drag(page, setRow(workout, bench, warmups + 2), setRow(workout, incline, 0), 0.1);
  await expect(page.locator("[data-move-ask]")).toContainText("Move 80 kg ");
  await expect(page.locator("[data-move-ask]")).toContainText("to Barbell Incline Bench Press - Medium Grip?");
  await menu(page).locator('[data-menu-item="move-yes"]').click();
  await expect(workout.locator(`[data-set][data-exercise="${incline}"]`)).toHaveCount(inclineSets + 1);
  await expect.poll(() => weights(page, bench)).toMatch(/ 60 70$/);
  await page.locator(".toast.front").filter({ hasText: /^\s*Moved/ }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => weights(page, bench)).toMatch(/ 60 70 80$/);
});

/** Holds `from` until it lifts (and the exercises fold), then moves it so the finger is at the height `aim` gives
 * then, before anything slides to make room, and lets go unless `keep`. */
async function dragTo(page: Page, from: Locator, aim: () => Promise<number>, keep = false): Promise<void> {
  await from.click({ trial: true }); // still: not sliding in with the sheet
  const start = (await from.boundingBox())!;
  const x = start.x + 100;
  await page.mouse.move(x, start.y + start.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  const y = await aim();
  await page.mouse.move(x, y, { steps: 12 });
  await page.waitForTimeout(200);
  if (!keep) await page.mouse.up();
}

const order = (page: Page) => page.locator("[data-timeline] [data-workout-exercise]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-workout-exercise")).join(" "));

test("exercises drag by their heading: reordered with Undo, joined, out of a superset or into another part when asked, the started ones kept first", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const workout = page.getByRole("dialog", { name: "Workout" });
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  const bench = "barbell-bench-press-medium-grip";
  const incline = "barbell-incline-bench-press-medium-grip";
  const row = "bent-over-barbell-row";
  for (const [query, name] of [["barbell bench press", "Barbell Bench Press - Medium Grip"], ["barbell incline bench press", "Barbell Incline Bench Press - Medium Grip"], ["bent over barbell row", "Bent Over Barbell Row"]]) {
    await addToWorkout(page, "add-exercise");
    await adding.getByLabel("Search exercises").fill(query);
    await adding.getByRole("button", { name: `Add ${name}`, exact: true }).click();
    await expect(adding).toHaveCount(0);
  }
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);
  const heading = (id: string) => workout.locator(`[data-workout-exercise="${id}"]`);
  const above = (id: string) => async () => { const box = (await heading(id).boundingBox())!; return box.y + 4; };

  // Held and let go: its menu, as a tap on its photo opens.
  const still = (await heading(incline).boundingBox())!;
  await page.mouse.move(still.x + 100, still.y + still.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(menu(page).locator('[data-menu-item="how-to"]')).toBeVisible();
  // The press opened nothing else: the exercise didn't fold or open.
  await expect(heading(incline)).not.toHaveAttribute("data-open");
  await closeMenu(page);

  // Dragged to the top: everything folds while it's up, it's there at once, and Undo puts it back.
  await dragTo(page, heading(row), above(bench), true);
  await expect(workout.locator('[data-timeline] [data-set]')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => order(page)).toBe(`${row} ${bench} ${incline}`);
  await page.locator(".toast.front").filter({ hasText: "Bent Over Barbell Row moved" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);

  // Onto the middle of another exercise: lit while it's over it, and asked to make a superset.
  const middleOf = (id: string) => async () => { const box = (await heading(id).boundingBox())!; return box.y + box.height / 2; };
  await dragTo(page, heading(row), middleOf(incline), true);
  await expect(workout.locator(`[data-row].join [data-workout-exercise="${incline}"]`)).toBeVisible();
  await expect(page.locator("[data-drag-note]")).toContainText("Superset Bent Over Barbell Row with Barbell Incline Bench Press - Medium Grip?");
  await page.mouse.up();
  await expect(page.locator("[data-move-ask]")).toContainText("You do one set of each, then rest.");
  await expect(workout.locator("[data-superset]")).toHaveCount(1);
  await menu(page).locator('[data-menu-item="move-yes"]').click();
  await expect(workout.locator("[data-superset]")).toHaveCount(1);
  await page.locator(".toast.front").filter({ hasText: "Superset made" }).getByRole("button", { name: "Undo" }).click();
  await expect(workout.locator("[data-superset]")).toHaveCount(0);
  // Or just moved there, under it, on its own.
  await dragTo(page, heading(row), middleOf(bench));
  await expect(page.locator("[data-move-ask]")).toContainText("Superset Bent Over Barbell Row with Barbell Bench Press - Medium Grip?");
  await menu(page).locator('[data-menu-item="move-alt"]').click();
  await expect.poll(() => order(page)).toBe(`${bench} ${row} ${incline}`);
  await expect(workout.locator("[data-superset]")).toHaveCount(0);
  await page.locator(".toast.front").filter({ hasText: /^\s*Moved/ }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);

  // Out of a superset: asked first, with it already out behind the question.
  await (await exerciseMenu(page, row)).locator('[data-menu-item="superset"]').click();
  await expect(workout.locator("[data-superset]")).toHaveCount(1);
  await dragTo(page, heading(row), above(bench));
  await expect(page.locator("[data-move-ask]")).toContainText("Take Bent Over Barbell Row out of the superset?");
  await expect.poll(() => order(page)).toBe(`${row} ${bench} ${incline}`);
  await expect(workout.locator("[data-superset]")).toHaveCount(0);
  await menu(page).locator('[data-menu-item="move-back"]').click();
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);
  await expect(workout.locator("[data-superset]")).toHaveCount(1);
  // The superset's own heading moves all of it.
  await dragTo(page, workout.locator('[data-superset] [data-run-heading]'), above(bench));
  await expect.poll(() => order(page)).toBe(`${incline} ${row} ${bench}`);
  await page.locator(".toast.front").filter({ hasText: "Superset moved" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);
  await fromExerciseMenu(page, row, "superset");

  // With a warm-up part (from a plan): dropped under its heading, an exercise asks to join it.
  await page.evaluate((id) => {
    const key = Object.keys(localStorage).find((each) => each.startsWith("gymbro-workout:"))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.exercises.find((each: { exerciseId: string }) => each.exerciseId === id).part = "warmup";
    localStorage.setItem(key, JSON.stringify(draft));
  }, bench);
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(workout.locator('[data-part="main"]')).toBeVisible();
  // Just over the WORKOUT heading: the end of the warm-up.
  await dragTo(page, heading(row), async () => { const box = (await workout.locator('[data-part="main"]').boundingBox())!; return box.y - 4; });
  await expect(page.locator("[data-move-ask]")).toContainText("Move Bent Over Barbell Row to the warm-up?");
  await menu(page).locator('[data-menu-item="move-back"]').click();
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);

  // Once an exercise is started, nothing goes above it.
  await workout.locator(`[data-set-node="${bench}-0"]`).click();
  await expect(workout.locator(`[data-set-node="${bench}-0"]`)).toHaveAttribute("aria-pressed", "true");
  await dragTo(page, heading(row), above(bench), true);
  await expect(page.locator("[data-drag-note]")).toContainText("The exercises you've done stay first.");
  await page.mouse.up();
  await expect(page.locator(".toast").filter({ hasText: "The exercises you've done stay first." })).toBeVisible();
  await expect.poll(() => order(page)).toBe(`${bench} ${incline} ${row}`);
});

test("on a touch screen the rows held float over the finger, and the note sits at the top of the timeline", async ({ page, browserName }) => {
  // Touches only Chromium can send (CDP); WebKit runs the same code with a mouse in the tests above.
  test.skip(browserName !== "chromium", "touch drag needs CDP");
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const workout = page.getByRole("dialog", { name: "Workout" });
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  for (const [query, name] of [["barbell bench press", "Barbell Bench Press - Medium Grip"], ["barbell deadlift", "Barbell Deadlift"]]) {
    await addToWorkout(page, "add-exercise");
    await adding.getByLabel("Search exercises").fill(query);
    await adding.getByRole("button", { name: `Add ${name}`, exact: true }).click();
    await expect(workout.locator(`[data-workout-exercise]`).last()).toContainText(name);
  }
  const deadSets = workout.locator('[data-timeline] [data-set][data-exercise="barbell-deadlift"]');
  await expect(deadSets).not.toHaveCount(0);
  const set = deadSets.last();
  await set.scrollIntoViewIfNeeded();
  await set.click({ trial: true });

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const box = (await set.boundingBox())!;
  const x = box.x + 120;
  const y = box.y + box.height / 2;
  await touch("touchStart", x, y);
  const lifted = workout.locator("[data-timeline] .ev.lifted").first();
  await expect(lifted).toBeVisible();
  // Lifted, nothing has moved: the set is drawn a little over the finger, not under it.
  await expect.poll(async () => { const at = (await lifted.boundingBox())!; return Math.round(y - (at.y + at.height)); }).toBe(24);

  const bench = (await workout.locator('[data-workout-exercise="barbell-bench-press-medium-grip"]').boundingBox())!;
  // The finger a set and a bit under the bench press heading puts the set (over it) among the bench press's sets.
  const to = bench.y + bench.height + box.height + 40;
  for (let step = 1; step <= 10; step++) {
    await touch("touchMove", x, y + ((to - y) * step) / 10);
    await page.waitForTimeout(20);
  }
  await expect.poll(async () => { const at = (await lifted.boundingBox())!; return Math.round(to - (at.y + at.height)); }).toBe(24);
  // Its note is pinned at the top of the timeline in view, clear of the finger and the set.
  const note = workout.locator("[data-drag-note]");
  await expect(note).toContainText("Move the set to Barbell Bench Press - Medium Grip?");
  await expect(note).toBeInViewport();
  const noteBox = (await note.boundingBox())!;
  expect(noteBox.y + noteBox.height).toBeLessThan((await lifted.boundingBox())!.y);
  await touch("touchEnd", x, to);
  await page.locator('[data-menu] [data-menu-item="move-back"]').click();
  await expect(deadSets).toHaveCount(3);
});
