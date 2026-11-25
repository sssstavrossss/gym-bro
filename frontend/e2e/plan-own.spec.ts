import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plan-own-${Date.now()}-${test.info().project.name}`;
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

test("Build your own: empty workouts in turn, fill and rename one, and fewer days drop the last", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");

  await page.locator("[data-build-own]").click();
  const setupSheet = page.getByRole("dialog", { name: "New plan" });
  await expect(setupSheet.getByRole("radio", { name: "Your own" })).toHaveAttribute("aria-checked", "true");
  await expect(setupSheet.locator("[data-plan-preview]")).toContainText("Your own, 3 workouts in turn");
  await setupSheet.locator("[data-plan-save]").click();
  await expect(page.getByText("Plan made")).toBeVisible();

  const card = page.locator("[data-plan-card]");
  await expect(card.locator("[data-plan-workout]")).toHaveCount(3);
  await expect(card.locator('[data-plan-workout="Workout A"]')).toContainText("No exercises yet");
  const next = page.locator("[data-up-next]");
  await expect(next).toContainText("No exercises yet");
  await next.locator("[data-up-next-fill]").click();

  const sheet = page.getByRole("dialog", { name: "Edit Workout A" });
  await expect(sheet.locator("[data-plan-workout-empty]")).toBeVisible();
  await expect(sheet.locator("[data-plan-workout-save]")).toBeDisabled();
  await sheet.locator("[data-plan-workout-name]").fill("  Push   day ");
  // A new name alone doesn't make a workout: it needs an exercise.
  await expect(sheet.locator("[data-plan-workout-save]")).toBeDisabled();
  await sheet.getByRole("button", { name: "Exercise", exact: true }).click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("barbell bench press");
  await adding.getByRole("button", { name: "Add Barbell Bench Press - Medium Grip", exact: true }).click();
  await expect(sheet.locator('[data-plan-exercise="barbell-bench-press-medium-grip"] [data-plan-exercise-line]')).toHaveText("3 × 6–10 · Rest 2:00");
  await sheet.locator("[data-plan-workout-save]").click();
  await expect(page.getByText("Saved Push day")).toBeVisible();

  await expect(card.locator('[data-plan-workout="Push day"]')).toContainText("1 exercise · 3 sets");
  await expect(next.getByRole("button", { name: "Start Push day" })).toBeVisible();

  // Fewer days keep what's built and drop the last workout, saying so first.
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const editSheet = page.getByRole("dialog", { name: "Edit plan" });
  await editSheet.getByRole("button", { name: "Friday" }).click();
  await expect(editSheet.locator("[data-plan-drops-note]")).toHaveText("With 2 days, saving drops Workout C from your plan.");
  await expect(editSheet.locator("[data-plan-edits-note]")).toHaveCount(0);
  await editSheet.locator("[data-plan-save]").click();
  await expect(card.locator("[data-plan-workout]")).toHaveCount(2);
  await expect(card.locator("[data-plan-workout]").first()).toHaveAttribute("data-plan-workout", "Push day");
  await expect(card.locator("[data-plan-workout]").nth(1)).toHaveAttribute("data-plan-workout", "Workout B");
});
