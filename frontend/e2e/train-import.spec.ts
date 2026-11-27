import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<{ oid: string; today: string }> {
  const oid = `e2e-train-import-${Date.now()}-${test.info().project.name}`;
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
  return { oid, today: when.today };
}

/** Until a sheet has slid in, WebKit can drop a tap on it. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

function daysBefore(today: string, days: number): string {
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

/** An old Strong export: commas, no unit on the weights. */
function strongCsv(today: string): Buffer {
  const first = daysBefore(today, 10);
  const second = daysBefore(today, 8);
  return Buffer.from([
    "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
    `${first} 18:00:00,Push,1h,Bench Press (Barbell),W,95,10,0,0,,,`,
    `${first} 18:00:00,Push,1h,Bench Press (Barbell),1,185,5,0,0,,,8`,
    `${first} 18:00:00,Push,1h,Rest Timer,1,0,0,0,90,,,`,
    `${first} 18:00:00,Push,1h,Mystery Row Thing,1,100,10,0,0,,,`,
    `${second} 07:30:00,Legs,50m,Squat (Barbell),1,225,5,0,0,,,`,
  ].join("\n"));
}

test("Import from Strong: match the rest, then the workouts count as done", async ({ page }) => {
  await page.goto("/");
  const { oid, today } = await setup(page);
  await page.goto("/train");

  await page.locator("[data-trained-before]").getByRole("button", { name: "Import from Strong or Hevy" }).click();
  await settled(page.getByRole("dialog", { name: "Import workouts" }));
  // The sheet's name follows its view (Import workouts, then Match …).
  const sheet = page.getByRole("dialog").filter({ has: page.locator("[data-import], [data-import-pick]") });
  await expect(sheet).toContainText("In Strong, open Settings and Export data");

  // A file that isn't an export says so.
  await sheet.locator("[data-import-file]").setInputFiles({ name: "foods.csv", mimeType: "text/csv", buffer: Buffer.from("name,kcal\nApple,52\n") });
  await expect(sheet.locator("[data-import-error]")).toContainText("isn't a workout export");

  await sheet.locator("[data-import-file]").setInputFiles({ name: "strong.csv", mimeType: "text/csv", buffer: strongCsv(today) });
  await expect(sheet.locator("[data-import-summary]")).toContainText("2 workouts");
  await expect(sheet.locator("[data-import-to-match]")).toHaveText("1");
  await expect(sheet.locator('[data-import-name="Bench Press (Barbell)"]')).toContainText("→ ");

  // The file doesn't say kg or lb: these are pounds.
  await sheet.locator("[data-import-unit]").getByRole("radio", { name: "lb" }).click();

  // The one with no match: pick it from the library.
  await sheet.getByRole("button", { name: "Pick the match for Mystery Row Thing" }).click();
  await expect(sheet.locator("[data-import-picking]")).toHaveText("Mystery Row Thing");
  await sheet.getByRole("searchbox", { name: "Search exercises" }).fill("seated cable rows");
  await sheet.locator('[data-exercise="seated-cable-rows"]').click();
  await expect(sheet.locator('[data-import-name="Mystery Row Thing"]')).toContainText("→ Seated Cable Rows");
  await expect(sheet.locator("[data-import-to-match]")).toHaveText("0");

  await sheet.locator("[data-import-send]").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".toast").filter({ hasText: "Imported 2 workouts" })).toBeVisible();
  await expect(page.locator("[data-workout-history]")).toBeVisible();
  await expect(page.locator("[data-trained-before]")).toHaveCount(0);

  const list = await (await page.request.get(`/api/workouts?from=${daysBefore(today, 10)}&to=${today}`, { headers: headers(oid) })).json();
  expect(list.workouts.map((item: { name: string }) => item.name)).toEqual(["Legs", "Push"]);
  expect(list.workouts.every((item: { status: string }) => item.status === "done")).toBe(true);
  // 185 lb × 5 and 100 lb × 10 (the warm-up doesn't count), in kg.
  expect(list.workouts[1].volumeKg).toBeCloseTo(185 * 0.45359237 * 5 + 100 * 0.45359237 * 10, 0);
  expect(list.workouts[1].exercises).toContain("seated-cable-rows");

  // Again from Settings: the same file adds nothing, and closing goes back to Settings.
  await page.goto("/profile");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settled(settings);
  await settings.locator("[data-import-row]").click();
  await settled(page.getByRole("dialog", { name: "Import workouts" }));
  const again = page.getByRole("dialog").filter({ has: page.locator("[data-import], [data-import-pick]") });
  await again.locator("[data-import-file]").setInputFiles({ name: "strong.csv", mimeType: "text/csv", buffer: strongCsv(today) });
  await again.getByRole("button", { name: "Pick the match for Mystery Row Thing" }).click();
  await again.getByRole("searchbox", { name: "Search exercises" }).fill("seated cable rows");
  await again.locator('[data-exercise="seated-cable-rows"]').click();
  await again.locator("[data-import-send]").click();
  await expect(page.locator(".toast").filter({ hasText: "already here" })).toBeVisible();
  await expect(settings).toBeVisible();
  const after = await (await page.request.get(`/api/workouts?from=${daysBefore(today, 10)}&to=${today}`, { headers: headers(oid) })).json();
  expect(after.workouts).toHaveLength(2);
});
