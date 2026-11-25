import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
  const oid = `e2e-train-library-${Date.now()}-${test.info().project.name}`;
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

test("Train holds the exercise library: search, body areas, and how to do one", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/today");

  // Train took Log's place in the tab bar. The Log page itself is still there.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Log" })).toHaveCount(0);
  await tabs.getByRole("link", { name: "Train" }).click();
  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByRole("heading", { name: "Train", exact: true })).toBeVisible();
  await expect(page.locator("[data-exercise-count]")).toHaveText("884");

  // Every word matches the start of a word; names that start with the query come first.
  const search = page.getByLabel("Search exercises");
  await search.fill("barbell squat");
  const rows = page.locator("[data-exercise]");
  await expect(rows.first()).toHaveAttribute("data-exercise", "barbell-squat");
  await search.fill("no such lift");
  await expect(page.getByText("No exercises match “no such lift”.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");

  // Cardio holds our own stations as well as free-exercise-db's.
  await page.getByRole("button", { name: "Cardio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cardio", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-exercise="skierg"]')).toBeVisible();
  await expect(page.locator('[data-exercise="barbell-squat"]')).toHaveCount(0);
  await page.locator('[data-exercise="skierg"]').click();

  const sheet = page.getByRole("dialog", { name: "SkiErg" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-exercise-steps] li")).toHaveCount(3);
  await expect(sheet.getByText("Steps written for Gym Bro")).toBeVisible();
  const demo = sheet.getByRole("link", { name: "Watch a demo" });
  await expect(demo).toHaveAttribute("href", /youtube\.com\/results\?search_query=SkiErg/);
  await expect(demo).toHaveAttribute("target", "_blank");

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => item.id))).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // A free-exercise-db exercise: its muscles, steps and credit.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await search.fill("barbell squat");
  await rows.first().click();
  const squat = page.getByRole("dialog", { name: "Barbell Squat" });
  const muscles = squat.getByLabel("Muscles");
  await expect(muscles.getByText("Quadriceps")).toBeVisible();
  await expect(muscles.getByRole("heading", { name: "Helping" })).toBeVisible();
  // The body map lights the main muscle and dims the helping ones, front and back.
  await expect(muscles.locator('[data-muscle-view="front"] [data-muscle="quadriceps"]')).toHaveClass(/\bmain\b/);
  await expect(muscles.locator('[data-muscle-view="back"] [data-muscle="glutes"]')).toHaveClass(/\bhelp\b/);
  await expect(muscles.locator('[data-muscle-view="front"] [data-muscle="chest"]')).toHaveClass(/\bidle\b/);
  await expect(squat.locator("[data-exercise-steps] li").first()).toBeVisible();
  await expect(squat.getByText("Photos and steps: free-exercise-db, public domain")).toBeVisible();

  const page2 = await new AxeBuilder({ page }).include("main").analyze();
  const serious2 = page2.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious2, JSON.stringify(serious2.map((item) => item.id))).toEqual([]);
});
