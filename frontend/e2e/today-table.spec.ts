import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const longName = `${"Superlongcataloguename".repeat(8)} protein bar`;

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

async function putWeighIn(request: APIRequestContext, oid: string, date: string, zone: string) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg: 83.6, timeZone: zone },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function logQuick(request: APIRequestContext, oid: string, date: string, zone: string, name: string, time: string, kcal: number) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: kcal > 1000 ? "long-name-row" : "short-name-row",
      localDate: date,
      timeZone: zone,
      name,
      time,
      kcal,
      protein: 10,
      fat: 5,
      carbs: 20,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test("the today log keeps its columns when a name and the calories are wide", async ({ page }) => {
  const oid = `e2e-today-table-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await logQuick(page.request, oid, when.today, when.zone, longName, "08:15", 4096);
  await logQuick(page.request, oid, when.today, when.zone, "Short oats", "12:30", 120);
  await sign(page, oid);

  for (const size of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/today");
    const rows = page.locator("button.frow");
    await expect(rows).toHaveCount(2);
    const long = rows.filter({ hasText: "Superlongcataloguename" });
    await expect(long.locator(".name")).toHaveText(longName);
    await expect(long.locator(".kc")).toHaveText("4,096");

    const measured = await rows.evaluateAll((nodes) => nodes.map((node) => {
      const name = node.querySelector(".name");
      const block = node.querySelector(".two");
      const time = node.querySelector(".time");
      const kcal = node.querySelector(".kc");
      if (!(name instanceof HTMLElement) || !(block instanceof HTMLElement) || !(time instanceof HTMLElement) || !(kcal instanceof HTMLElement)) return null;
      const line = node.closest(".line");
      const dot = line?.querySelector(".dot");
      if (!(dot instanceof HTMLElement)) return null;
      const nameBox = name.getBoundingClientRect();
      const blockBox = block.getBoundingClientRect();
      const timeBox = time.getBoundingClientRect();
      const kcalBox = kcal.getBoundingClientRect();
      const dotBox = dot.getBoundingClientRect();
      const rowBox = node.getBoundingClientRect();
      const nameStyle = getComputedStyle(name);
      const kcalStyle = getComputedStyle(kcal);
      return {
        rowHeight: Math.round(rowBox.height),
        nameLeft: Math.round(nameBox.left),
        nameHeight: Math.round(nameBox.height),
        timeLeft: Math.round(timeBox.left),
        timeTop: Math.round(timeBox.top),
        timeMid: timeBox.top + timeBox.height / 2,
        blockMid: blockBox.top + blockBox.height / 2,
        dotMid: dotBox.top + dotBox.height / 2,
        kcalRight: Math.round(kcalBox.right),
        kcalMid: kcalBox.top + kcalBox.height / 2,
        nameTop: Math.round(nameBox.top),
        clipped: name.scrollWidth > name.clientWidth + 1,
        whiteSpace: nameStyle.whiteSpace,
        overflowWrap: nameStyle.overflowWrap,
        textOverflow: nameStyle.textOverflow,
        figures: kcalStyle.fontVariantNumeric,
        align: kcalStyle.textAlign,
      };
    }));
    expect(measured.every((row) => row !== null)).toBe(true);
    const cast = measured as {
      rowHeight: number; nameLeft: number; nameHeight: number; timeLeft: number; timeTop: number; timeMid: number; blockMid: number; dotMid: number;
      kcalRight: number; kcalMid: number; nameTop: number; clipped: boolean;
      whiteSpace: string; overflowWrap: string; textOverflow: string; figures: string; align: string;
    }[];
    const [tall, short] = cast[0].nameHeight >= cast[1].nameHeight ? [cast[0], cast[1]] : [cast[1], cast[0]];
    expect(tall.nameLeft).toBe(short.nameLeft);
    expect(tall.timeLeft).toBe(short.timeLeft);
    expect(Math.abs(tall.kcalRight - short.kcalRight)).toBeLessThanOrEqual(1);
    expect(tall.rowHeight).toBeGreaterThan(short.rowHeight);
    expect(tall.nameHeight).toBeGreaterThan(short.nameHeight);
    expect(tall.clipped).toBe(false);
    expect(tall.whiteSpace).not.toBe("nowrap");
    expect(tall.overflowWrap).toBe("anywhere");
    expect(tall.textOverflow).not.toBe("ellipsis");
    expect(Math.abs(tall.kcalMid - tall.blockMid)).toBeLessThanOrEqual(2);
    expect(Math.abs(tall.timeMid - tall.blockMid)).toBeLessThanOrEqual(2);
    expect(Math.abs(tall.dotMid - tall.timeMid)).toBeLessThanOrEqual(2);
    expect(cast.every((row) => row.figures.includes("tabular-nums"))).toBe(true);
    expect(cast.every((row) => row.align === "right")).toBe(true);

    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector(".scroller");
      const root = document.documentElement;
      const scrollerOk = !scroller || scroller.scrollWidth <= scroller.clientWidth + 1;
      return root.scrollWidth <= root.clientWidth + 1 && scrollerOk;
    });
    expect(overflow, `${size.width}px scrolls sideways`).toBe(true);

    if (size.width === 390 && test.info().project.name === "chromium") {
      const line = page.locator(".line").filter({ hasText: "Superlongcataloguename" });
      await line.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: "/opt/cursor/artifacts/today-table-long-name-phone.png" });
      await line.screenshot({ path: "/opt/cursor/artifacts/today-row-wrapped-phone.png" });
    }
  }
});
