import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { addDays } from "../src/lib/dates";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
  });
}

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

async function putProfile(request: APIRequestContext, oid: string, zone: string) {
  const response = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male",
      birthYear: 1990,
      heightCm: 180,
      activity: "moderate",
      goal: "lose",
      rateKgPerWeek: 0.5,
      goalWeightKg: 80,
      proteinSetting: "normal",
      proteinGramsPerKg: 2,
      fatSetting: "normal",
      fatPercent: 25,
      timeZone: zone,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function putWeighIn(request: APIRequestContext, oid: string, date: string, zone: string, kg: number) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg, timeZone: zone },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function logQuick(request: APIRequestContext, oid: string, date: string, zone: string, name: string, kcal: number, protein: number) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${name}-${date}`,
      localDate: date,
      timeZone: zone,
      name,
      time: "08:00",
      kcal,
      protein,
      fat: 1,
      carbs: 1,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

function backdateSetup(oid: string) {
  execFileSync("psql", [
    "-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro",
    "-c", `UPDATE profiles SET created_at = created_at - interval '4 days' WHERE user_id = '${oid}'`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector(".scroller");
    const root = document.documentElement;
    const scrollerOk = !scroller || scroller.scrollWidth <= scroller.clientWidth + 1;
    return root.scrollWidth <= root.clientWidth + 1 && scrollerOk;
  });
  expect(overflow).toBe(true);
}

async function openProgress(page: Page, width: number) {
  await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Progress", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
}

test.describe("progress", () => {
  test("phone and desktop show weigh-ins, logged days, and leave empty days blank", async ({ page }) => {
    const oid = `e2e-progress-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    const earlier = addDays(when.today, -2);
    await putWeighIn(page.request, oid, earlier, when.zone, 84);
    await putProfile(page.request, oid, when.zone);
    backdateSetup(oid);
    await putWeighIn(page.request, oid, when.today, when.zone, 83.6);
    await logQuick(page.request, oid, earlier, when.zone, "Fictional oats", 400, 40);
    await logQuick(page.request, oid, when.today, when.zone, "Fictional broth", 600, 20);
    await sign(page, oid);

    await openProgress(page, 390);
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary.getByText("83.6 kg")).toBeVisible();
    await expect(summary.getByText(/[−-]0\.4 kg/)).toBeVisible();
    await expect(summary.locator(".stat").first().locator(".t-label")).not.toHaveText(/kg/);
    await expect(summary).toContainText("500");
    await expect(summary).toContainText("30");
    await expect(summary.getByText("2", { exact: true })).toBeVisible();
    await expect(page.getByText("Days with no food are left out, not treated as zero.").or(page.getByText(/left out, not treated as zero/))).toBeVisible();
    const weightChart = page.getByRole("img", { name: /Weigh-ins/ });
    await expect(weightChart).toBeVisible();
    const label = (await weightChart.getAttribute("aria-label")) ?? "";
    expect(label).toContain("83.6");
    expect(label).toContain("84");
    expect(label).toMatch(/blank|not a weight/i);
    const calories = page.getByRole("img", { name: /Calories on logged days/ });
    const calorieLabel = (await calories.getAttribute("aria-label")) ?? "";
    expect(calorieLabel).toContain("400");
    expect(calorieLabel).toContain("600");
    expect(calorieLabel).toMatch(/not zero/i);
    expect(calorieLabel).not.toMatch(/\b0 kcal\b/);
    await expectNoSideScroll(page);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
    expect(serious.map((item) => item.id)).toEqual([]);
    if (test.info().project.name === "chromium") {
      await page.screenshot({ path: "/opt/cursor/artifacts/progress-phone.png" });
      await page.locator("section.chart").filter({ has: page.getByRole("heading", { name: "Calories" }) }).screenshot({ path: "/opt/cursor/artifacts/progress-phone-calories.png" });
    }

    await page.getByRole("radio", { name: "7 days" }).click();
    await expect(summary).toContainText("500");
    await expectNoSideScroll(page);

    await page.setViewportSize({ width: 320, height: 700 });
    const rangeBox = await page.getByRole("radiogroup", { name: "Range" }).boundingBox();
    expect(rangeBox && rangeBox.x >= -1 && rangeBox.x + rangeBox.width <= 321).toBeTruthy();
    await page.getByRole("radio", { name: "6 months" }).click();
    await expect(summary).toContainText("of 182 days");
    await expectNoSideScroll(page);

    await openProgress(page, 1440);
    await expect(page.locator("aside.side")).toBeVisible();
    await expect(page.locator("main.progress")).toHaveClass(/two|three/);
    await expect(summary.getByText("83.6 kg")).toBeVisible();
    const deskRange = await page.getByRole("radiogroup", { name: "Range" }).boundingBox();
    const desk = page.viewportSize();
    expect(deskRange && desk && deskRange.x + deskRange.width <= desk.width + 1).toBeTruthy();
    await expectNoSideScroll(page);
    if (test.info().project.name === "chromium") {
      await page.screenshot({ path: "/opt/cursor/artifacts/progress-desktop.png" });
    }
  });

  test("a weigh-in with no food explains the empty intake", async ({ page }) => {
    const oid = `e2e-progress-empty-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await putWeighIn(page.request, oid, when.today, when.zone, 83.6);
    await putProfile(page.request, oid, when.zone);
    await sign(page, oid);
    await openProgress(page, 390);
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("83.6");
    await expect(summary).toContainText("One weigh-in, so no change");
    await expect(page.getByText("No food logged in this range").first()).toBeVisible();
    await expect(summary).not.toContainText("0 kcal");
  });
});
