import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

function macro(value: number): string {
  const sign = value < 0 ? -1 : 1;
  const rounded = (sign * Math.round((Math.abs(value) * 10) + Number.EPSILON)) / 10;
  if (rounded === 0) return "0";
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function figure(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

async function createFood(request: APIRequestContext, oid: string, name: string, kcal: number, protein: number, fat: number, carbs: number) {
  const response = await request.post("/api/foods", {
    headers: headers(oid),
    data: { name, kcalPer100: kcal, proteinPer100: protein, fatPer100: fat, carbsPer100: carbs, basis: "g", nutrientBasis: "per_100" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).id as string;
}

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

test("recipe chip detail wraps the full macros at iPhone width", async ({ page }) => {
  const oid = `e2e-recipe-chip-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const weighed = await page.request.put(`/api/weigh-ins/${when.today}`, {
    headers: headers(oid),
    data: { kg: 83.6, timeZone: when.zone },
  });
  expect(weighed.ok(), await weighed.text()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();

  const chicken = await createFood(page.request, oid, "Chip chicken", 165, 31, 3.6, 0);
  const oats = await createFood(page.request, oid, "Chip oats", 379, 13, 7, 67);
  const yogurt = await createFood(page.request, oid, "Chip yogurt", 97, 9, 5, 4);
  const oil = await createFood(page.request, oid, "Chip oil", 884, 0, 100, 0);
  const name = "Weeknight chicken rice bowl with yogurt oats and olive oil";
  const created = await page.request.post("/api/recipes", {
    headers: headers(oid),
    data: {
      name,
      portions: 2,
      finishedGrams: 600,
      ingredients: [
        { foodId: chicken, amount: 180, unit: "g" },
        { foodId: oats, amount: 80, unit: "g" },
        { foodId: yogurt, amount: 100, unit: "g" },
        { foodId: oil, amount: 10, unit: "g" },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const recipe = await created.json();
  const per = recipe.perPortion;
  const detailText = `${recipe.ingredients.length} foods · ${figure(per.kcal)} kcal P ${macro(per.protein)} · F ${macro(per.fat)} · C ${macro(per.carbs)} per portion · ${figure(recipe.finishedGrams)} g finished`;

  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await page.getByRole("button", { name: "Log your first food today" }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).blur();
  await food.getByRole("button", { name: /Recipes/ }).click();
  const row = food.locator(".rrow").filter({ hasText: name });
  const detail = row.locator("[data-recipe-detail]");
  await expect(detail).toHaveText(detailText);

  const metrics = await detail.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.textOverflow).not.toBe("ellipsis");
  expect(metrics.whiteSpace).not.toContain("nowrap");

  const wrapped = await row.locator("[data-recipe-name]").evaluate((el) => {
    const nameBox = el.getBoundingClientRect();
    const mark = el.parentElement?.querySelector(".mark")?.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(el).lineHeight);
    return {
      nameHeight: nameBox.height,
      line,
      nameTop: nameBox.top,
      markTop: mark?.top ?? -1,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  });
  expect(wrapped.nameHeight).toBeGreaterThan(wrapped.line + 1);
  expect(wrapped.scrollWidth).toBeLessThanOrEqual(wrapped.clientWidth);
  expect(wrapped.markTop).toBeGreaterThanOrEqual(wrapped.nameTop - 2);
  expect(wrapped.markTop).toBeLessThan(wrapped.nameTop + wrapped.line);

  const scrolls = await page.evaluate(() => {
    const nodes = [document.scrollingElement, ...document.querySelectorAll(".scroller, .screen")];
    return nodes.filter((el): el is Element => !!el).map((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
  });
  for (const item of scrolls) expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);

  const log = row.getByRole("button", { name: `Log recipe ${name}` });
  const box = await log.boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBeTruthy();
});
