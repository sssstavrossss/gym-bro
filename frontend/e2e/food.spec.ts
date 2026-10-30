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
  return response.json();
}

async function putWeighIn(request: APIRequestContext, oid: string, date: string, zone: string) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg: 83.6, timeZone: zone },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openToday(page: Page, oid: string, width: number) {
  await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
  await sign(page, oid);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function expectClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => ({
    id: item.id,
    impact: item.impact,
    nodes: item.nodes.slice(0, 3).map((node) => node.html),
  })))).toEqual([]);
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

async function expectNumbersWhole(page: Page) {
  const clipped = await page.evaluate(() => {
    return [...document.querySelectorAll("[data-num]")].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && node.scrollWidth > node.clientWidth + 1;
    }).map((node) => node.textContent);
  });
  expect(clipped).toEqual([]);
}

function foodSheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

function macroField(page: Page, name: string) {
  return foodSheet(page).getByRole("textbox", { name, exact: true });
}

async function openQuickAdd(page: Page, width: number) {
  if (width >= 1024) {
    await page.getByRole("button", { name: "Add food" }).click();
  } else {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  }
  await expect(page.getByRole("dialog", { name: "Add", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Add food" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Quick Add" })).toBeChecked();
}

test("today empty, quick add, on target, edit, undo, and no sideways scroll", async ({ page }) => {
  const oid = `e2e-food-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  const profile = await putProfile(page.request, oid, when.zone);
  const target = profile.targets.kcal as number;

  for (const width of [375, ...widths, 1920]) {
    await openToday(page, oid, width);
    await expectNoSideScroll(page);
  }

  await openToday(page, oid, 390);
  await expect(page.getByRole("button", { name: /Log your first food today/ })).toBeVisible();
  await expect(page.getByText("Open log")).toHaveCount(0);
  await expectClean(page);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ });
  const foodBox = await food.boundingBox();
  expect(foodBox!.width).toBeGreaterThanOrEqual(44);
  expect(foodBox!.height).toBeGreaterThanOrEqual(44);
  await food.click();
  await expect(page.getByRole("dialog", { name: "Add", exact: true })).toBeHidden();
  const close = foodSheet(page).getByRole("button", { name: "Close", exact: true });
  const closeBox = await close.boundingBox();
  expect(closeBox!.width).toBeGreaterThanOrEqual(44);
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);
  await expectClean(page);
  await close.click();

  await openToday(page, oid, 820);
  await expect(page.getByText("Nothing logged yet today")).toBeVisible();
  await expect(page.getByText("Open log")).toHaveCount(0);

  await openQuickAdd(page, 820);
  await macroField(page, "Name (optional)").fill("Fictional bar");
  await macroField(page, "Calories").fill(String(target));
  await macroField(page, "Protein").fill("10");
  await macroField(page, "Fat").fill("5");
  await macroField(page, "Carbs").fill("20");
  await foodSheet(page).getByRole("button", { name: /Add · .*kcal/ }).click();
  await expect(page.getByText(/Added Fictional bar/)).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("On target ±5%")).toBeVisible();
  await expect(page.getByText("kcal left").or(page.getByText("kcal over"))).toBeVisible();
  await expect(page.getByRole("img", { name: /Calories/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fictional bar/ })).toBeVisible();
  await expectNoSideScroll(page);
  await expectClean(page);

  await page.getByRole("button", { name: /Fictional bar/ }).click();
  await expect(page.getByRole("heading", { name: "Edit food" })).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "Delete", exact: true });
  const deleteBox = await deleteButton.boundingBox();
  expect(deleteBox!.width).toBeGreaterThanOrEqual(44);
  expect(deleteBox!.height).toBeGreaterThanOrEqual(44);
  await macroField(page, "Calories").fill(String(target + 500));
  await foodSheet(page).getByRole("button", { name: /Save ·/ }).click();
  await expect(page.getByText("Over target")).toBeVisible();
  await expect(page.getByText(/over/).first()).toBeVisible();

  await page.getByRole("button", { name: /Fictional bar/ }).click();
  await deleteButton.click();
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page.getByRole("button", { name: /Fictional bar/ })).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expectNoSideScroll(page);
    await expect(page.getByText("Open log")).toHaveCount(0);
  }
});

test("a failed add stays pending and retry uses the same key", async ({ page }) => {
  const oid = `e2e-pending-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await openToday(page, oid, 390);
  await openQuickAdd(page, 390);
  await page.route("**/api/log-entries", (route) => {
    if (route.request().method() === "POST") return route.abort();
    return route.continue();
  });
  await macroField(page, "Name (optional)").fill("Fictional shake");
  await macroField(page, "Calories").fill("250");
  await macroField(page, "Protein").fill("20");
  await macroField(page, "Fat").fill("8");
  await macroField(page, "Carbs").fill("12");
  await foodSheet(page).getByRole("button", { name: /Add ·/ }).click();
  await expect(page.getByText(/server unreachable, try again/i)).toBeVisible();
  await expect(macroField(page, "Name (optional)")).toHaveValue("Fictional shake");
  await expect(page.getByText("Nothing was lost — your entry is still here.")).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible();
  const retryBox = await retry.boundingBox();
  expect(retryBox!.height).toBeGreaterThanOrEqual(44);

  await page.unroute("**/api/log-entries");
  await retry.click();
  await expect(page.getByRole("button", { name: /Fictional shake/ })).toBeVisible();
  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  expect(listed.ok()).toBeTruthy();
  const body = await listed.json();
  expect(body.entries).toHaveLength(1);
  expect(body.entries[0].name).toBe("Fictional shake");
  expect(body.entries[0].source).toBe("quick");
  expect(body.entries[0].grams).toBeNull();
});

test("kcal and macro numbers stay whole at the largest text size", async ({ page }) => {
  const oid = `e2e-ax5-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await openToday(page, oid, 390);
  await openQuickAdd(page, 390);
  await macroField(page, "Calories").fill("1800");
  await macroField(page, "Protein").fill("150");
  await macroField(page, "Fat").fill("60");
  await macroField(page, "Carbs").fill("180");
  await foodSheet(page).getByRole("button", { name: /Add ·/ }).click();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByText("kcal left").or(page.getByText("kcal over"))).toBeVisible();
  await expectNumbersWhole(page);
  await expectNoSideScroll(page);
  const entry = page.getByRole("button", { name: /Quick add/ });
  const box = await entry.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
