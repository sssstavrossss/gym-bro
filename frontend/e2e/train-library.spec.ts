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

test("Train opens the exercise library in a sheet: search, body areas, rows a step at a time, and how to do one", async ({ page }) => {
  await page.goto("/");
  await setup(page);
  await page.goto("/today");

  // Train took Log's place in the tab bar. The Log page itself is still there.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Log" })).toHaveCount(0);
  await tabs.getByRole("link", { name: "Train" }).click();
  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByRole("heading", { name: "Train", exact: true })).toBeVisible();
  // The page itself no longer lists exercises: the search button opens the library.
  await expect(page.locator("[data-exercise]")).toHaveCount(0);
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Exercises" });
  await expect(library).toBeVisible();
  await expect(library.locator("[data-exercise-total]")).toHaveText("886");
  // The search button opens it ready to type.
  await expect(library.getByLabel("Search exercises")).toBeFocused();

  // Rows draw 40 at a time; scrolling near the end draws more (Show more does it by hand). A click would chase
  // the button, since scrolling to it already draws the next rows. The pages beside the one in view are drawn
  // too, hidden, so a swipe has them ready: count only the rows in view.
  const rows = library.locator("[data-exercise]:visible");
  await expect(rows).toHaveCount(40);
  await library.locator("[data-exercise-more]").scrollIntoViewIfNeeded();
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(80);

  // Every word matches the start of a word; names that start with the query come first.
  const search = library.getByLabel("Search exercises");
  await search.fill("barbell squat");
  await expect(rows.first()).toHaveAttribute("data-exercise", "barbell-squat");
  await search.fill("no such lift");
  await expect(library.getByText("No exercises match “no such lift”.").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");

  // A type word finds its exercises: "hyrox" finds the stations, "weight lifting" the Olympic lifts.
  await search.fill("hyrox");
  await expect(rows.first()).toBeVisible();
  await expect(library.locator('[data-exercise="sled-push"]:visible')).toBeVisible();
  await expect(library.locator('[data-exercise="barbell-squat"]')).toHaveCount(0);
  await search.fill("weight lifting");
  await expect(library.locator('[data-exercise="clean-and-jerk"]:visible')).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();

  // Two rows: the type filters, the muscle group pages. Cardio holds our own stations as well as free-exercise-db's.
  const types = library.getByRole("group", { name: "Type" });
  const groups = library.getByRole("group", { name: "Muscle group" });
  await types.getByRole("button", { name: "Cardio", exact: true }).click();
  await expect(types.getByRole("button", { name: "Cardio", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(library.locator('[data-exercise="skierg"]:visible')).toBeVisible();
  await expect(library.locator('[data-exercise="barbell-squat"]')).toHaveCount(0);
  // Every row is cardio, so the rows don't name their type; under All types they do.
  await expect(library.locator("[data-exercise-tag]")).toHaveCount(0);
  // A muscle group page keeps the type: SkiErg works the lats, so it is under Back, and the run isn't.
  await groups.getByRole("button", { name: "Back", exact: true }).click();
  await expect(groups.getByRole("button", { name: "Back", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(library.locator('[data-exercise-page="back"] [data-exercise="skierg"]')).toBeVisible();
  await expect(library.locator('[data-exercise-page="back"] [data-exercise="run"]')).toHaveCount(0);
  await groups.getByRole("button", { name: "All", exact: true }).click();
  await expect(groups.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The chips follow the pages: one step back from All wraps round to Core, at the far end of the row, and the row
  // scrolls along so its chip is in view rather than lit up past the edge.
  await library.getByLabel("Muscle groups", { exact: true }).press("ArrowLeft");
  await expect(groups.getByRole("button", { name: "Core", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(groups.getByRole("button", { name: "Core", exact: true })).toBeInViewport({ ratio: 0.95 });
  await library.getByLabel("Muscle groups", { exact: true }).press("ArrowRight");
  await expect(groups.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(groups.getByRole("button", { name: "All", exact: true })).toBeInViewport({ ratio: 0.95 });
  await library.locator('[data-exercise="skierg"]:visible').click();

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

  // The how-to opened over the library: Esc goes back to the list.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(library).toBeVisible();

  // A free-exercise-db exercise: its muscles, steps and credit.
  await types.getByRole("button", { name: "All", exact: true }).click();
  await expect(library.locator('[data-exercise="barbell-squat"]:visible [data-exercise-tag]')).toHaveText("Strength");
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

  // Esc twice: back to the list, then the library closes.
  await page.keyboard.press("Escape");
  await expect(squat).toHaveCount(0);
  await expect(library).toBeVisible();
  const page2 = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious2 = page2.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious2, JSON.stringify(serious2.map((item) => item.id))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(library).toHaveCount(0);
  const page3 = await new AxeBuilder({ page }).include("main").analyze();
  const serious3 = page3.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious3, JSON.stringify(serious3.map((item) => item.id))).toEqual([]);
});
