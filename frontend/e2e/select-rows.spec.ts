import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("select mode keeps food rows inside the list and gives the check its own slot", async ({ page }) => {
  const oid = `e2e-select-rows-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 84, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  for (const [key, time, name, kcal] of [
    ["oats", "11:57", "Fictional select oats", 700],
    ["roll", "18:43", "Fictional select roll", 760],
  ] as const) {
    expect((await page.request.post("/api/log-entries", {
      headers: headers(oid),
      data: { idempotencyKey: `${oid}-${key}`, localDate: when.today, timeZone: when.zone, time, name, kcal, protein: 15, fat: 40, carbs: 70 },
    })).ok()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    document.documentElement.classList.add("demo-statusbar");
  }, oid);

  await page.goto("/log");
  const oats = page.locator(".line").filter({ hasText: "Fictional select oats" });
  const roll = page.locator(".line").filter({ hasText: "Fictional select roll" });
  await expect(oats).toBeVisible();
  const before = await edge(oats);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await oats.getByRole("button", { name: "Select Fictional select oats" }).click();
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toBeVisible();
  await expect.poll(() => oats.locator(".dot").evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(22, 0);

  await expectRow(oats, roll, before);
  await expectFlush(page.locator("main"));
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-select-log.png" });
  }

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page.locator("main.today .logc")).toBeVisible();
  await expectFlush(page.locator("main.today .logc"));
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-home.png" });
  }
  const homeOats = page.locator("main.today .logc .line").filter({ hasText: "Fictional select oats" });
  const homeRoll = page.locator("main.today .logc .line").filter({ hasText: "Fictional select roll" });
  await expect(homeOats).toBeVisible();
  await homeOats.evaluate((el) => {
    const box = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1,
      clientX: box.x + 80, clientY: box.y + 20,
    }));
  });
  await page.waitForTimeout(520);
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toBeVisible();
  await expect.poll(() => homeOats.locator(".dot").evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(22, 0);
  const card = await page.locator("main.today .logc").boundingBox();
  const homeLine = await homeOats.boundingBox();
  expect(card).toBeTruthy();
  expect(homeLine).toBeTruthy();
  expect(homeLine!.x).toBeGreaterThanOrEqual(card!.x + 12);
  expect(homeLine!.x + homeLine!.width).toBeLessThanOrEqual(card!.x + card!.width - 12);
  await expectRow(homeOats, homeRoll);
  await expectFlush(page.locator("main.today .logc"));
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-select-home.png" });
  }
});

async function expectFlush(scope: Locator) {
  const metrics = await scope.locator("[data-log-entries]").evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const rows = [...el.querySelectorAll(".line")];
    const first = rows[0].getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    const frow = getComputedStyle(rows[0].querySelector(".frow")!);
    const selected = el.querySelector(".line.sel");
    const swipe = selected?.closest(".swipe")?.getBoundingClientRect();
    const selectedBox = selected?.getBoundingClientRect();
    return {
      padTop: parseFloat(style.paddingTop),
      padBottom: parseFloat(style.paddingBottom),
      above: first.top - box.top,
      below: box.bottom - last.bottom,
      borderTop: parseFloat(style.borderTopWidth),
      borderBottom: parseFloat(style.borderBottomWidth),
      textPad: parseFloat(frow.paddingTop),
      selTop: selected && swipe && selectedBox ? selectedBox.top - swipe.top : null,
      selBottom: selected && swipe && selectedBox ? swipe.bottom - selectedBox.bottom : null,
    };
  });
  expect(metrics.padTop).toBe(0);
  expect(metrics.padBottom).toBe(0);
  expect(metrics.above).toBeLessThanOrEqual(metrics.borderTop + 0.5);
  expect(metrics.below).toBeLessThanOrEqual(metrics.borderBottom + 0.5);
  expect(metrics.textPad).toBeGreaterThanOrEqual(4);
  if (metrics.selTop != null) {
    expect(metrics.selTop).toBeLessThanOrEqual(0.5);
    expect(metrics.selBottom).toBeLessThanOrEqual(0.5);
  }
}

async function edge(line: Locator) {
  return line.locator(".kc").evaluate((el) => el.getBoundingClientRect().right);
}

async function expectRow(selected: Locator, other: Locator, previousRight?: number) {
  await selected.locator(".dot").evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  await other.locator(".dot").evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  const box = await selected.evaluate((el) => {
    const line = el.getBoundingClientRect();
    const list = el.closest("[data-log-entries]")!.getBoundingClientRect();
    const kcal = el.querySelector(".kc")!.getBoundingClientRect();
    const time = el.querySelector(".time")!.getBoundingClientRect();
    const mark = el.querySelector(".mark")!.getBoundingClientRect();
    const dot = el.querySelector(".dot")!.getBoundingClientRect();
    const dotStyle = getComputedStyle(el.querySelector(".dot")!);
    const otherLine = el.parentElement!.parentElement!.parentElement!.querySelector(".line:not(.sel)");
    const otherKcal = otherLine?.querySelector(".kc")?.getBoundingClientRect();
    return {
      lineL: line.left, lineR: line.right, lineW: line.width,
      listL: list.left, listR: list.right,
      kcalR: kcal.right, timeL: time.left,
      markW: mark.width, markH: mark.height,
      dotW: dot.width, dotH: dot.height, dotR: dot.right,
      bg: dotStyle.backgroundColor, shadow: dotStyle.boxShadow,
      otherR: otherKcal?.right ?? null, otherW: otherLine?.getBoundingClientRect().width ?? null,
    };
  });
  expect(box.lineL).toBeGreaterThanOrEqual(box.listL - 0.5);
  expect(box.lineR).toBeLessThanOrEqual(box.listR + 0.5);
  expect(box.kcalR).toBeLessThanOrEqual(box.lineR + 0.5);
  expect(box.kcalR).toBeGreaterThan(box.lineR - 48);
  if (previousRight != null) expect(Math.abs(box.kcalR - previousRight)).toBeLessThanOrEqual(1);
  if (box.otherR != null) expect(Math.abs(box.kcalR - box.otherR)).toBeLessThanOrEqual(1);
  if (box.otherW != null) expect(Math.abs(box.lineW - box.otherW)).toBeLessThanOrEqual(1);
  expect(box.markW).toBeGreaterThanOrEqual(44);
  expect(box.markH).toBeGreaterThanOrEqual(44);
  expect(box.dotW).toBeCloseTo(22, 0);
  expect(box.dotH).toBeCloseTo(22, 0);
  expect(box.timeL - box.dotR).toBeGreaterThanOrEqual(6);
  expect(box.bg).toBe("rgb(255, 255, 255)");
  expect(box.shadow).toBe("none");

  const open = await other.locator(".dot").evaluate((el) => {
    const style = getComputedStyle(el);
    return { bg: style.backgroundColor, shadow: style.boxShadow, width: parseFloat(style.width) };
  });
  expect(open.width).toBeCloseTo(22, 0);
  expect(open.bg).toBe("rgba(0, 0, 0, 0)");
  expect(open.shadow).toContain("inset");
}
