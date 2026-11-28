import { expect, test, type Page } from "@playwright/test";
import { pick } from "./dial";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-warmups-${Date.now()}-${test.info().project.name}`;
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

test("+ Warm-up ramps up to the working weight, then adds single empty ones", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empty workout" }).click();
  const adding = page.getByRole("dialog", { name: "Add exercise" });
  await adding.getByLabel("Search exercises").fill("barbell squat");
  await adding.getByRole("button", { name: "Add Barbell Squat", exact: true }).click();

  // The exercise opens on the timeline, its first set to do.
  const workout = page.getByRole("dialog", { name: "Workout" });
  await pick(page, workout.getByLabel("Set 1, kg", { exact: true }), 100);
  await workout.locator("[data-add-warmup]").click();
  await expect(page.getByText("4 warm-up sets, building to 100 kg")).toBeVisible();

  // The empty bar for 10, then about 40%, 60% and 80%, before set 1; the first warm-up is the set to do.
  const rows = workout.locator('[data-set][data-exercise="barbell-squat"]');
  const ramp = [["20", "10"], ["40", "8"], ["60", "5"], ["80", "3"]];
  for (const [index, [kg, reps]] of ramp.entries()) {
    await expect(rows.nth(index).locator('[data-cell$="-kg"]')).toContainText(kg);
    await expect(rows.nth(index).locator('[data-cell$="-reps"]')).toContainText(reps);
  }
  await expect(rows.nth(4).locator('[data-cell$="-kg"]')).toContainText("100");
  await expect(rows.nth(0)).toHaveAttribute("data-set-state", "now");
  await expect(workout.getByLabel("Warm-up set 1, kg", { exact: true })).toHaveText(/20$/);

  // Once there are warm-ups, the button adds one more, empty, after the others.
  await workout.locator("[data-add-warmup]").click();
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(4).locator('[data-cell$="-kg"]')).toContainText("—");
  await workout.locator("[data-log-set]").click();
  await expect(rows.nth(0)).toHaveAttribute("data-done", "");
  await expect(rows.nth(1)).toHaveAttribute("data-set-state", "now");
});
