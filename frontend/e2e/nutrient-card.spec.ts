import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Gym Bro Test", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = "Europe/Oslo";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

async function ready(request: APIRequestContext, oid: string, date: string, zone: string) {
  expect((await request.put(`/api/weigh-ins/${date}`, { headers: headers(oid), data: { kg: 90, timeZone: zone } })).ok()).toBeTruthy();
  expect((await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  })).ok()).toBeTruthy();
  const food = await request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name: "Oats", brand: null, barcode: null, basis: "g", nutrientBasis: "per_100",
      kcalPer100: 370, proteinPer100: 13, fatPer100: 7, carbsPer100: 60,
      saturatedFatPer100: 1.2, sugarsPer100: 1, fiberPer100: 10, saltPer100: 0.02,
      servingQuantity: null, servingLabel: null,
      nutrients: {
        monoFat: 2.4, polyFat: 2.8, omega3: 0.1, omega6: 2.2, transFat: 0, cholesterol: 0,
        addedSugars: 0, sodium: 400, vitaminA: 12, vitaminD: 0, vitaminE: 0.7,
        thiamin: 0.4, riboflavin: 0.15, niacin: 1.2, vitaminB6: 0.2, folate: 30,
        vitaminB12: 0, vitaminC: 40, calcium: 200, iron: 3, zinc: 2, magnesium: 90,
        potassium: 350, phosphorus: 280, selenium: 8, iodine: 4,
      },
    },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  const id = (await food.json()).id as string;
  expect((await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${oid}-oats`, localDate: date, timeZone: zone, time: "08:00",
      foodId: id, amount: 100, unit: "g", kcal: 1, protein: 1, fat: 1, carbs: 1,
    },
  })).ok()).toBeTruthy();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** The last row's ink, including a descender such as µ, stays inside the track and above the dots. */
async function expectRowsClear(page: Page, root: string) {
  const report = await page.locator(root).evaluate((card) => {
    const track = card.querySelector(".track")!;
    const dots = card.querySelector(".strip");
    const clip = track.getBoundingClientRect();
    const dotsTop = dots ? dots.getBoundingClientRect().top : clip.bottom;
    const canvas = document.createElement("canvas").getContext("2d")!;
    const panels = [...card.querySelectorAll("[data-panel]")];
    return panels.map((panel) => {
      const row = panel.querySelector(".nrow:last-child, .mrow:last-of-type");
      if (!row) return { id: panel.getAttribute("data-panel"), ok: true, reason: "no row" };
      const text = row.querySelector(".num, .vals") ?? row;
      const cs = getComputedStyle(text);
      canvas.font = cs.font;
      const sample = text.textContent ?? "";
      const measured = canvas.measureText(sample);
      const descent = measured.actualBoundingBoxDescent || 0;
      const fontSize = parseFloat(cs.fontSize);
      const lineHeight = parseFloat(cs.lineHeight);
      const box = text.getBoundingClientRect();
      const inkBottom = box.bottom - Math.max(0, (lineHeight - fontSize) / 2) + Math.max(0, descent - fontSize * 0.2);
      return {
        id: panel.getAttribute("data-panel"),
        ok: lineHeight + 0.5 >= fontSize && box.bottom <= clip.bottom + 0.5 && inkBottom <= dotsTop - 1,
        lineHeight,
        fontSize,
        bottom: box.bottom,
        clip: clip.bottom,
        inkBottom,
        dotsTop,
      };
    });
  });
  const clipped = report.filter((row) => !row.ok);
  expect(clipped, JSON.stringify(clipped)).toEqual([]);
}

test("the home nutrient card is 358 by 212 on every panel", async ({ page }) => {
  const oid = `e2e-nutrients-${Date.now()}`;
  const when = await clock(page);
  await ready(page.request, oid, when.today, when.zone);
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.setItem("gymbro-theme", "graphite");
  }, oid);
  await page.goto("/today");
  const card = page.locator("[data-nutrient-card]");
  await expect(card).toBeVisible();
  const dots = card.locator("button.dot");
  const count = await dots.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    await dots.nth(i).click();
    const box = await card.boundingBox();
    expect(Math.round(box!.width)).toBe(358);
    expect(Math.round(box!.height)).toBe(212);
  }

  await dots.nth(1).click();
  const fats = card.locator("[data-panel='fats']");
  const labels = fats.locator(".name");
  await expect(labels).toHaveText(["Fat", "Saturated", "Mono", "Poly", "Trans", "Omega-3", "Omega-6", "Cholesterol"]);
  const indent = await fats.locator(".name.indent").evaluate((node) => node.textContent);
  expect(indent).toBe("Saturated");
  const aligned = await fats.locator(".nrow").evaluateAll((nodes) => {
    const rows = nodes.map((node) => {
      const box = node.getBoundingClientRect();
      const value = node.querySelector(".nums")!.getBoundingClientRect();
      return { left: Math.round(box.left), right: Math.round(value.right), sameLine: Math.abs(box.top - value.top) < 4 };
    });
    const columns = [...new Set(rows.map((row) => row.left))];
    return columns.length === 2 && columns.every((left) => {
      const rights = rows.filter((row) => row.left === left).map((row) => row.right);
      return rights.every((right) => right === rights[0]) && rows.filter((row) => row.left === left).every((row) => row.sameLine);
    });
  });
  expect(aligned).toBe(true);

  await expectRowsClear(page, "[data-nutrient-card]");

  const pip = await card.locator("button.dot.on .pip").evaluate((node) => node.getBoundingClientRect().width);
  const idle = await card.locator("button.dot:not(.on) .pip").first().evaluate((node) => node.getBoundingClientRect().width);
  expect(pip).toBeGreaterThan(idle);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => card.locator("button.dot").count()).toBeGreaterThan(count);
  const grown = await card.boundingBox();
  expect(grown!.height).toBeGreaterThan(212);
  const largeDots = card.locator("button.dot");
  const largeCount = await largeDots.count();
  const width = (await card.boundingBox())!.width;
  if (largeCount * 44 > width) {
    await expect(card.locator("button.half")).toHaveCount(2);
    await expect(largeDots.first()).toHaveAttribute("aria-hidden", "true");
  }
  const heights: number[] = [];
  for (let i = 0; i < largeCount; i++) {
    await largeDots.nth(i).click({ force: true });
    heights.push(Math.round((await card.boundingBox())!.height));
  }
  expect(new Set(heights).size).toBe(1);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    window.dispatchEvent(new Event("resize"));
  });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Search or quick add/ }).click();
  await page.getByRole("searchbox", { name: "Search foods" }).fill("Oats");
  await page.getByRole("button", { name: /^Oats/ }).first().click();
  const preview = page.locator(".preview");
  await expect(preview).toBeVisible();
  await expectRowsClear(page, ".preview");
  await expectAmountFlush(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  await expectAmountFlush(page);
});

/** Amount's right edge matches the panel's inner right edge. Per 100 g sits just before it. */
async function expectAmountFlush(page: Page) {
  const gaps = await page.locator(".preview").evaluate((root) => {
    const panel = root.querySelector("[data-panel]")!;
    const right = panel.getBoundingClientRect().right;
    return [...root.querySelectorAll(".nrow, .heads")].map((row) => {
      const amount = row.querySelector(":scope > .amt") ?? row.querySelector(":scope > .num:last-child") ?? row.querySelector(":scope > span:last-child");
      const per = row.querySelector(":scope > .per") ?? row.querySelector(":scope > span:nth-child(2)");
      if (!amount) return 0;
      const amountBox = amount.getBoundingClientRect();
      const perBox = per ? per.getBoundingClientRect() : null;
      return {
        gap: Math.round(right - amountBox.right),
        order: perBox ? perBox.right <= amountBox.left + 1 : true,
      };
    });
  });
  for (const row of gaps) {
    expect(row.gap).toBeLessThanOrEqual(1);
    expect(row.order).toBe(true);
  }
}
