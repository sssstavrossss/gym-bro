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

async function ready(request: APIRequestContext, oid: string, date: string, zone: string, logFood = true) {
  expect((await request.put(`/api/weigh-ins/${date}`, { headers: headers(oid), data: { kg: 90, timeZone: zone } })).ok()).toBeTruthy();
  expect((await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  })).ok()).toBeTruthy();
  if (!logFood) return;
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

// The data is dated in Oslo, so the browser must agree on "today" (CI runs in UTC; near midnight they differ).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Oslo" });

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
      if (!row) {
        // The cards and the ring grids: their last block ends inside the track, at most at the top
        // of the dot strip, whose own 12px keep it clear of the dots.
        const last = panel.lastElementChild!.getBoundingClientRect();
        return { id: panel.getAttribute("data-panel"), ok: last.bottom <= clip.bottom + 0.5 && last.bottom <= dotsTop + 0.5, bottom: last.bottom, clip: clip.bottom, dotsTop };
      }
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
        ok: Math.round((lineHeight / fontSize) * 100) / 100 >= 1.3 && box.bottom <= clip.bottom + 0.5 && inkBottom <= dotsTop - 1,
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

test("the home nutrient card is 358 by 214 on every panel", async ({ page }) => {
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
    expect(Math.round(box!.height)).toBe(214);
  }

  // Macros: what is left beside each bar, "to go" for the protein minimum.
  await dots.nth(0).click();
  await expect(card.locator("[data-macro='kcal'] [data-left]")).toHaveText(/^[\d,]+ left$/);
  await expect(card.locator("[data-macro='p'] [data-left]")).toHaveText(/^[\d,]+ to go$/);
  await expect(card.locator("[data-macro] [data-adding]")).toHaveCount(0);

  await dots.nth(1).click();
  const fats = card.locator("[data-panel='fats']");
  await expect(fats.locator("[data-fat-total]")).toHaveText("7 g");
  await expect(fats.locator("[data-fat-part] .t-label:not(.num)")).toHaveText(["Saturated", "Mono", "Poly", "Trans", "Not broken down"]);
  await expect(fats.locator("[data-fat-part='rest'] .num")).toHaveText("0.6 g");
  await expect(fats.locator("[data-saturated-limit]")).toContainText("≤ 10% of kcal");
  await expect(fats.locator("[data-fat-row] .c2")).toHaveText(["Omega-3", "Omega-6", "EPA + DHA", "Cholesterol"]);
  // Every food knows its fats, so there is no coverage note, and normal limits have no tag.
  await expect(fats.locator(".note")).toHaveCount(0);
  await expect(fats.locator("[data-fat-limits]")).toHaveCount(0);
  const nested = await fats.locator("[data-fat-row]").evaluateAll((rows) => {
    // Where the text starts: the label's left edge plus its padding.
    const start = (key: string) => {
      const label = rows.find((row) => row.getAttribute("data-fat-row") === key)!.querySelector(".c2") as HTMLElement;
      const box = label.getBoundingClientRect();
      return { top: box.top, left: box.left, text: box.left + parseFloat(getComputedStyle(label).paddingLeft) };
    };
    const omega = start("omega3");
    const epa = start("epaDha");
    return epa.top > omega.top && Math.round(epa.left) === Math.round(omega.left) && epa.text - omega.text >= 8;
  });
  expect(nested).toBe(true);
  const rights = await fats.locator("[data-fat-part] .num, [data-fat-row] .end").evaluateAll((nodes) => [...new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().right)))].length);
  expect(rights).toBe(2);

  // Carbs: 100 g of Oats is 60 g of carbs, 1 g of it sugars, and no starch on the label.
  await dots.nth(2).click();
  const carbs = card.locator("[data-panel='carbs']");
  await expect(carbs.locator("[data-carb-total]")).toHaveText("60 g");
  await expect(carbs.locator("[data-carb-part] .t-label:not(.num)")).toHaveText(["Sugars", "Starch", "Added", "Not broken down"]);
  await expect(carbs.locator("[data-carb-part='sugars'] .num")).toHaveText("1 g");
  await expect(carbs.locator("[data-carb-part='rest'] .num")).toHaveText("59 g");
  const fibre = carbs.locator("[data-carb-limit='fiber']");
  // The Progress card's minimum: 35 g for a man.
  await expect(fibre.locator(".end")).toHaveText("10 / 35 g");
  await expect(fibre.locator("[data-to-go]")).toHaveText(/^[\d.]+ to go$/);
  await expect(carbs.locator("[data-carb-limit='addedSugars']")).toContainText("≤ 10% of kcal");
  await expect(carbs.locator("[data-carb-limit='sodium'] .end")).toHaveText("400 / 2300 mg");
  await expect(carbs.locator(".overtag")).toHaveCount(0);

  const strip = await card.locator(".strip").evaluate((node) => node.getBoundingClientRect().height);
  const hit = await card.locator("button.dot").first().evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.round(strip)).toBe(30);
  expect(hit).toBeGreaterThanOrEqual(44);
  await expectDotBand(page, "[data-nutrient-card]");
  await expectDotBand(page, ".home-progress");

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
  // Largest text keeps plain rows, four to a page, instead of the Fats card and rings.
  await expect(card.locator("[data-panel^='fats-'] .name").first()).toHaveText("Fat");
  await expect(card.locator("[data-ring]")).toHaveCount(0);
  expect(Math.round(grown!.width)).toBe(358);
  expect(Math.round(grown!.height)).toBe(214);
  await expectRowsClear(page, "[data-nutrient-card]");
  const largeDots = card.locator("button.dot");
  const largeCount = await largeDots.count();
  const width = (await card.boundingBox())!.width;
  if (largeCount * 44 > width) {
    await expect(card.locator("button.half")).toHaveCount(2);
    await expect(largeDots.first()).toHaveAttribute("aria-hidden", "true");
  }
  const heights: number[] = [];
  for (let i = 0; i < largeCount; i++) {
    await card.locator(".track").evaluate((track, index) => {
      const el = track as HTMLElement;
      el.scrollTo({ left: index * el.clientWidth, behavior: "auto" });
    }, i);
    heights.push(Math.round((await card.boundingBox())!.height));
  }
  expect(new Set(heights).size).toBe(1);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    window.dispatchEvent(new Event("resize"));
  });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search foods" }).fill("Oats");
  await page.getByRole("button", { name: /^Oats/ }).first().click();
  const preview = page.locator(".preview");
  await expect(preview).toBeVisible();
  // The Home card again, the same size, for the day with this food in it.
  expect(Math.round((await preview.boundingBox())!.height)).toBe(214);
  await expect(preview.locator("[data-panel='macros'] .panel-title")).toHaveText("Today after adding");
  await expect(preview.locator("[data-macro='kcal'] [data-adding]")).toHaveText(/^\+[\d,]+$/);
  await expect(preview.locator("[data-macro='kcal'] [data-added]")).toHaveCount(1);
  const sheetStrip = await preview.locator(".strip").evaluate((node) => node.getBoundingClientRect().height);
  const sheetHit = await preview.locator("button.dot").first().evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.round(sheetStrip)).toBe(30);
  expect(sheetHit).toBeGreaterThanOrEqual(44);
  await expectDotBand(page, ".preview");
  await expectRowsClear(page, ".preview");
  const sheetDots = preview.locator("button.dot");
  await sheetDots.nth(1).click();
  await expect(preview.locator("[data-panel='fats'] [data-fat-total]")).toHaveText("7 g");
  await sheetDots.nth(2).click();
  // One food: the fibre bar, without the day's "to go".
  await expect(preview.locator("[data-carb-limit='fiber']")).toBeVisible();
  await expect(preview.locator("[data-to-go]")).toHaveCount(0);
  // The rings show the portion and don't open the day's nutrient sheet over this one.
  await expect(preview.locator("[data-ring]").first()).toHaveAttribute("role", "img");
  await expect(preview.locator("button[data-ring]")).toHaveCount(0);
  // 12px between the quick amounts and the Add button, as on the weight sheet.
  const trayGap = await page.locator("[data-amount-tray] .chips").evaluate((chips) => {
    const button = chips.parentElement!.querySelector(".actions")!.getBoundingClientRect();
    return Math.round(button.top - chips.getBoundingClientRect().bottom);
  });
  expect(trayGap).toBe(12);

  // Largest text: plain rows with Per 100 g beside the amount.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  await expect(preview.locator("[data-panel='fats-0']")).toHaveCount(1);
  await expectAmountFlush(page);
  const sheetSlots = await preview.locator("[data-panel='fats-0'] .fig").evaluateAll((figs) => {
    const groups = new Map<number, { numbers: number[]; units: number[] }>();
    for (const fig of figs) {
      const column = Math.round(fig.getBoundingClientRect().left / 8);
      const number = (fig.querySelector(".num") as HTMLElement).getBoundingClientRect().right;
      const unit = (fig.querySelector(".unit") as HTMLElement).getBoundingClientRect().left;
      const group = groups.get(column) ?? { numbers: [], units: [] };
      group.numbers.push(Math.round(number));
      group.units.push(Math.round(unit));
      groups.set(column, group);
    }
    return [...groups.values()];
  });
  expect(sheetSlots.length).toBe(2);
  for (const group of sheetSlots) {
    expect(new Set(group.numbers).size).toBe(1);
    expect(new Set(group.units).size).toBe(1);
  }
});

/**
 * 12px, the dots, 12px: the strip ends at the card's bottom edge. The 44px tap box reaches 7px
 * below the card, so a clipped card must not cut it off. When the dots are too many for 44px each
 * (Progress on a phone), the strip's back and forward halves take that tap instead.
 */
async function expectDotBand(page: Page, root: string) {
  await page.locator(root).first().evaluate((card) => card.scrollIntoView({ block: "center" }));
  const band = await page.locator(root).first().evaluate((card) => {
    const stripNode = card.querySelector(".strip")!;
    const strip = stripNode.getBoundingClientRect();
    const dot = card.querySelector("button.dot:not(.on)") as HTMLElement;
    const pip = dot.querySelector(".pip")!.getBoundingClientRect();
    const edge = card.getBoundingClientRect().bottom;
    const x = pip.left + pip.width / 2;
    const below = document.elementFromPoint(x, Math.min(edge + 5, window.innerHeight - 1));
    return {
      above: Math.round(pip.top - strip.top),
      below: Math.round(strip.bottom - pip.bottom),
      edge: Math.round(edge - strip.bottom),
      tap: stripNode.classList.contains("halves") ? !!below?.closest(".half") : below === dot || dot.contains(below),
    };
  });
  expect(band).toEqual({ above: 12, below: 12, edge: 0, tap: true });
}

/** Amount's right edge matches its panel's inner right edge. Per 100 g sits just before it. */
async function expectAmountFlush(page: Page) {
  const gaps = await page.locator(".preview").evaluate((root) => {
    return [...root.querySelectorAll(".nrow, .heads, .cols")].flatMap((row) => {
      const panel = row.closest("[data-panel]")!;
      const right = panel.getBoundingClientRect().right - parseFloat(getComputedStyle(panel).paddingRight);
      const directNums = [...row.querySelectorAll(":scope > .num")];
      const table = row.classList.contains("heads") || row.classList.contains("cols") || row.querySelector(":scope > .amt") || directNums.length > 1;
      if (!table) return [];
      const amount = row.querySelector(":scope > .amt") ?? directNums.at(-1) ?? row.querySelector(":scope > span:last-child");
      const per = row.querySelector(":scope > .per") ?? (directNums.length > 1 ? directNums[0] : row.querySelector(":scope > span:nth-child(2)"));
      if (!amount || amount === per) return [];
      const amountBox = amount.getBoundingClientRect();
      const perBox = per ? per.getBoundingClientRect() : null;
      return [{
        gap: Math.round(right - amountBox.right),
        order: perBox ? perBox.right <= amountBox.left + 1 : true,
      }];
    });
  });
  expect(gaps.length).toBeGreaterThan(0);
  for (const row of gaps) {
    expect(Math.abs(row.gap)).toBeLessThanOrEqual(1);
    expect(row.order).toBe(true);
  }
}

test("with nothing logged the card keeps every page and its dots", async ({ page }) => {
  const oid = `e2e-nutrients-empty-${Date.now()}`;
  const when = await clock(page);
  await ready(page.request, oid, when.today, when.zone, false);
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  const card = page.locator("[data-nutrient-card]");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-panel]")).toHaveCount(5);
  await expect(card.locator("button.dot")).toHaveCount(5);
  const box = (await card.boundingBox())!;
  expect(Math.round(box.height)).toBe(214);
  expect(Math.round((await card.locator(".strip").boundingBox())!.height)).toBe(30);
  await expectDotBand(page, "[data-nutrient-card]");
  await expectRowsClear(page, "[data-nutrient-card]");
  // Every page reads 0, with no coverage note: there are no foods to be missing data.
  await card.locator("button.dot").nth(2).click();
  await expect(card.locator("[data-carb-total]")).toHaveText("0 g");
  await expect(card.locator(".note")).toHaveCount(0);
});

test("the swipe cards wrap like a carousel at both ends", async ({ page }) => {
  const oid = `e2e-carousel-${Date.now()}`;
  const when = await clock(page);
  await ready(page.request, oid, when.today, when.zone);
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  const card = page.locator("[data-nutrient-card]");
  await expect(card).toBeVisible();
  const track = card.locator(".track");
  const dots = card.locator("button.dot");
  const count = await dots.count();
  expect(count).toBeGreaterThan(2);
  const at = (scroll: "start" | "end") => track.evaluate((el, edge) => {
    const max = el.scrollWidth - el.clientWidth;
    return edge === "start" ? el.scrollLeft <= 2 : el.scrollLeft >= max - 2;
  }, scroll);
  const swipe = async (from: number, to: number) => {
    const box = (await track.boundingBox())!;
    const y = box.y + box.height / 2;
    await track.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: from, clientY: y }], changedTouches: [{ identifier: 1, clientX: from, clientY: y }] });
    await track.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: to, clientY: y + 6 }] });
  };

  // Past the last card is the first, sliding in from the right like any next card:
  // the track never scrolls back across the cards in between.
  await dots.nth(count - 1).click();
  await expect.poll(() => at("end")).toBe(true);
  await track.evaluate((el) => {
    const seen: number[] = [];
    (window as unknown as { seen: number[] }).seen = seen;
    el.addEventListener("scroll", () => seen.push(el.scrollLeft / el.clientWidth));
  });
  await swipe(300, 120);
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => at("start")).toBe(true);
  await expect(track).not.toHaveClass(/wrapping/);
  const pages = await page.evaluate(() => (window as unknown as { seen: number[] }).seen);
  expect(pages.length).toBeGreaterThan(0);
  expect(pages.filter((p) => p > 0.01).every((p) => p >= count - 2 - 0.01)).toBe(true);
  expect(await track.evaluate((el) => [...el.children].every((child) => (child as HTMLElement).style.order === ""))).toBe(true);

  // Before the first card is the last.
  await swipe(80, 260);
  await expect(dots.nth(count - 1)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => at("end")).toBe(true);

  // A tiny drag does nothing.
  await swipe(300, 290);
  await expect(dots.nth(count - 1)).toHaveAttribute("aria-current", "true");

  // The side tap zone wraps too.
  await card.getByRole("button", { name: "Next panel" }).last().click();
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => at("start")).toBe(true);
});
