import { expect, test, type Locator, type Page } from "@playwright/test";
import { pick, setRow } from "./dial";
import { addToWorkout, closeMenu, menu } from "./timeline";

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
