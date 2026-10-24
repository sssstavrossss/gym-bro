import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const widths = [390, 820, 1440] as const;

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    const day = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return format.format(date);
    };
    return { zone, today: day(0), yesterday: day(-1), earlier: day(-2), ago: day(-29) };
  });
}

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

function profileBody(zone: string, goalWeightKg: number) {
  return {
    sex: "male",
    birthYear: 1990,
    heightCm: 180,
    activity: "moderate",
    goal: "lose",
    rateKgPerWeek: 0.5,
    goalWeightKg,
    proteinSetting: "normal",
    proteinGramsPerKg: 2,
    fatSetting: "normal",
    fatPercent: 25,
    timeZone: zone,
  };
}

async function putWeighIn(request: APIRequestContext, oid: string, date: string, kg: number, zone: string, confirm = false) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg, timeZone: zone, confirm },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function putProfile(request: APIRequestContext, oid: string, zone: string, goalWeightKg: number) {
  const response = await request.put("/api/profile", {
    headers: headers(oid),
    data: profileBody(zone, goalWeightKg),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openApp(page: Page, oid: string, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await sign(page, oid);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function expectClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((item) => ({
    id: item.id,
    impact: item.impact,
    nodes: item.nodes.slice(0, 3).map((node) => node.html),
  })))).toEqual([]);
}

test("low accuracy dot, sheet, and profile", async ({ page }) => {
  const oid = `e2e-low-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone, 80);
  for (const width of widths) {
    await openApp(page, oid, width);
    await expect(page.getByText("not ready")).toHaveCount(0);
    await expect(page.getByText("provisional")).toHaveCount(0);
    const dot = page.getByRole("button", { name: /Low accuracy/ }).first();
    await expect(dot).toBeVisible();
    const box = await dot.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(/latest 83\.6 · low accuracy/)).toBeVisible();
    await expectClean(page);
    await dot.click();
    await expect(page.getByRole("heading", { name: "Low accuracy" })).toBeVisible();
    await expect(page.getByText("Only 1 weigh-in this week, so the trend is less accurate.")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Log weight", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Got it" })).toBeVisible();
    await expectClean(page);
    await page.getByRole("button", { name: "Got it" }).click();
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page.getByRole("button", { name: /trend · low accuracy/i })).toContainText("83.60");
    if (width === 1440) {
      await expect(page.locator("aside.side").getByRole("button", { name: /Low accuracy/ })).toBeVisible();
    }
  }
});

test("fresh start asks, and Not now writes nothing", async ({ page }) => {
  const oid = `e2e-fresh-no-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.ago, 80, when.zone);
  await putProfile(page.request, oid, when.zone, 70);
  await putWeighIn(page.request, oid, when.today, 90, when.zone, true);
  const before = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
  for (const width of widths) {
    await openApp(page, oid, width);
    await expect(page.getByRole("heading", { name: "Fresh start" })).toBeVisible();
    await expect(page.getByText("Recalculate your targets from today's weight?")).toBeVisible();
    await expect(page.getByText(/\d[\d,]* → \d[\d,]* kcal/)).toBeVisible();
    await page.getByRole("button", { name: /Open weight/ }).first().click();
    await expect(page.locator(".stats")).toContainText("—");
    await expect(page.getByText("This week")).toBeVisible();
    await expect(page.getByText("30 days", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Log weight" })).toHaveCount(0);
    await expectClean(page);
  }
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: "Fresh start" })).toHaveCount(0);
  const after = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
  expect(after.targets.reason).toBe(before.targets.reason);
  expect(after.targets.kcal).toBe(before.targets.kcal);
  expect(after.targets.reason).not.toBe("fresh_start");
});

test("fresh start Recalculate writes today's fresh_start target", async ({ page }) => {
  const oid = `e2e-fresh-yes-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.ago, 80, when.zone);
  await putProfile(page.request, oid, when.zone, 70);
  await putWeighIn(page.request, oid, when.today, 90, when.zone, true);
  await openApp(page, oid, 390);
  await page.getByRole("button", { name: "Recalculate" }).click();
  await expect(page.getByRole("heading", { name: "Fresh start" })).toHaveCount(0);
  const after = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
  expect(after.targets.reason).toBe("fresh_start");
  expect(after.targets.weightKg).toBe(90);
  await expect(page.getByText(/New target from today/)).toBeHidden({ timeout: 6000 });
  await expectClean(page);
});

test("typo guard asks inline and Fix it saves nothing", async ({ page }) => {
  const oid = `e2e-typo-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.yesterday, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone, 80);
  for (const width of widths) {
    await openApp(page, oid, width);
    await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
    await expect(page.getByRole("heading", { name: "Log weight" })).toBeVisible();
    await expect(page.getByText("Last 30 days")).toBeVisible();
    await expect(page.getByText("weigh-in").first()).toBeVisible();
    const field = page.getByRole("textbox", { name: "Weight in kilograms" });
    await field.fill("38.6");
    await page.getByRole("button", { name: "Save weight" }).click();
    await expect(page.getByRole("heading", { name: "Is 38.6 kg right?" })).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText("83.60 kg");
    await expectClean(page);
    await page.getByRole("button", { name: "Fix it" }).click();
    await expect(page.getByRole("heading", { name: "Is 38.6 kg right?" })).toHaveCount(0);
    const listed = await (await page.request.get("/api/weigh-ins", { headers: headers(oid) })).json();
    expect(listed.weighIns.some((row: { kg: number }) => row.kg === 38.6)).toBeFalsy();
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
  await page.getByRole("textbox", { name: "Weight in kilograms" }).fill("38.6");
  await page.getByRole("button", { name: "Save weight" }).click();
  await page.getByRole("button", { name: "Yes, save" }).click();
  await expect(page.getByRole("heading", { name: "Log weight" })).toHaveCount(0);
  const saved = await (await page.request.get(`/api/weigh-ins?from=${when.today}&to=${when.today}`, { headers: headers(oid) })).json();
  expect(saved.weighIns[0].kg).toBe(38.6);
  const kept = await (await page.request.get(`/api/weigh-ins?from=${when.yesterday}&to=${when.yesterday}`, { headers: headers(oid) })).json();
  expect(kept.weighIns[0].kg).toBe(83.6);
});

test("a back-dated weigh-in is checked against the day before it", async ({ page }) => {
  const oid = `e2e-back-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.earlier, 83.6, when.zone);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone, 80);
  await openApp(page, oid, 390);
  await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
  await page.getByLabel("Weigh-in day").selectOption({ index: 1 });
  await page.getByRole("textbox", { name: "Weight in kilograms" }).fill("90");
  await page.getByRole("button", { name: "Save weight" }).click();
  await expect(page.getByRole("heading", { name: "Is 90.0 kg right?" })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText("83.60 kg");
  await page.getByRole("button", { name: "Fix it" }).click();
  const listed = await (await page.request.get("/api/weigh-ins", { headers: headers(oid) })).json();
  expect(listed.weighIns.some((row: { localDate: string }) => row.localDate === when.yesterday)).toBeFalsy();
});

test("goal reached asks on the latest weigh-in and changes nothing until chosen", async ({ page }) => {
  const oid = `e2e-goal-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone, 84);
  for (const width of widths) {
    await openApp(page, oid, width);
    await expect(page.getByRole("heading", { name: "You've reached your goal weight" })).toBeVisible();
    await expectClean(page);
  }
  await page.getByRole("button", { name: "Keep my goal" }).click();
  await expect(page.getByRole("heading", { name: "You've reached your goal weight" })).toHaveCount(0);
  const after = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
  expect(after.profile.goal).toBe("lose");
  expect(after.weight.goalReached).toBe(true);
});

test("deleting the only weigh-in clears the trend", async ({ page }) => {
  const oid = `e2e-del-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone, 80);
  await openApp(page, oid, 390);
  await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No weigh-ins yet")).toBeVisible();
  const trend = await (await page.request.get("/api/weight/trend", { headers: headers(oid) })).json();
  expect(trend.trendKg).toBeNull();
  expect(trend.source).toBe("none");
});
