import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
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
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("range stays put, the safe strip is clear, rows tap cleanly, and home has no kcal card", async ({ page }) => {
  const oid = `e2e-polish37-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  await putProfile(page.request, oid, when.zone);
  for (let i = 0; i < 2; i += 1) {
    expect((await page.request.post("/api/log-entries", {
      headers: headers(oid),
      data: {
        idempotencyKey: `${oid}-log-${i}`,
        localDate: when.today,
        timeZone: when.zone,
        time: i === 0 ? "08:15" : "12:40",
        name: i === 0 ? "Fictional morning oats" : "Fictional lunch plate",
        kcal: 400,
        protein: 20,
        fat: 8,
        carbs: 40,
      },
    })).ok()).toBeTruthy();
  }
  for (let i = 0; i < 8; i += 1) {
    expect((await page.request.post("/api/foods", {
      headers: headers(oid),
      data: {
        name: `Fictional scroll apple ${i + 1}`,
        kcalPer100: 52,
        proteinPer100: 0,
        fatPer100: 0,
        carbsPer100: 14,
        basis: "g",
        nutrientBasis: "per_100",
      },
    })).ok()).toBeTruthy();
  }
  await sign(page, oid);

  await page.goto("/today");
  await page.evaluate(() => document.documentElement.style.setProperty("--sat", "47px"));
  await expect(page.getByText("kcal left")).toHaveCount(0);
  await expect(page.getByText("kcal over")).toHaveCount(0);
  const firstCard = page.locator("main.today .c-a .card").first();
  await expect(firstCard).toContainText("Calories");
  await expect(firstCard.getByText("Protein")).toBeVisible();
  await expectUnderStrip(page, 47);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone37-home.png" });
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone37-safe-strip.png", clip: { x: 0, y: 0, width: 390, height: 120 } });
  }

  await page.goto("/log");
  const line = page.locator(".line").first();
  await expect(line).toBeVisible();
  await expect(line).toHaveCSS("border-top-width", "1px");
  await expect(line).toHaveCSS("border-bottom-width", "1px");
  await expect(line).toHaveCSS("border-top-color", "rgb(58, 63, 74)");
  const gap = await line.locator(".frow").evaluate((el) => parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap));
  expect(gap).toBeLessThanOrEqual(6);
  if (test.info().project.name === "chromium") await page.screenshot({ path: "/opt/cursor/artifacts/iphone37-log.png" });

  await page.goto("/progress");
  await expect(page.getByText("Current weight")).toBeVisible();
  const main = page.locator("main.progress");
  await main.evaluate((el) => { el.dataset.live = "1"; });
  const scroller = page.locator(".scroller");
  await scroller.evaluate((el) => { el.scrollTop = 220; });
  const before = await scroller.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(100);
  const loaded = page.waitForResponse((response) => response.url().includes("/api/progress") && response.ok());
  await page.getByRole("radio", { name: "All", exact: true }).click();
  await loaded;
  await expect(page.getByRole("radio", { name: "All", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(main).toHaveAttribute("data-live", "1");
  const after = await scroller.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  expect(page.url()).toContain("/progress");
  if (test.info().project.name === "chromium") await page.screenshot({ path: "/opt/cursor/artifacts/iphone37-progress.png" });

  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).fill("Fictional scroll");
  const row = food.getByRole("button", { name: /Fictional scroll apple 1/ });
  await expect(row).toBeVisible();
  if (test.info().project.name === "chromium") await page.screenshot({ path: "/opt/cursor/artifacts/iphone37-search.png" });
  await row.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: box.x + 20, clientY: box.y + 12, pointerId: 1, pointerType: "touch" });
    el.dispatchEvent(down);
    el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: box.x + 24, clientY: box.y + 70, pointerId: 1, pointerType: "touch" }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: box.x + 24, clientY: box.y + 70 }));
  });
  await expect(food.getByRole("heading", { name: "Fictional scroll apple 1" })).toHaveCount(0);
  await row.click();
  await expect(food.getByRole("heading", { name: "Fictional scroll apple 1" })).toBeVisible();
});

async function expectUnderStrip(page: Page, limit: number) {
  const strip = page.locator("[data-safe-top]");
  await expect(strip).toHaveCSS("position", "fixed");
  const height = await strip.evaluate((el) => parseFloat(getComputedStyle(el).height));
  expect(height).toBeCloseTo(limit, 0);
  const background = await strip.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  const offenders = await page.evaluate((top) => {
    const nodes = [...document.querySelectorAll("body *")];
    return nodes.flatMap((el) => {
      if (!(el instanceof HTMLElement)) return [];
      if (el.closest("[data-safe-top]") || el.classList.contains("sr-only") || el.classList.contains("app") || el.classList.contains("scroller")) return [];
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return [];
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || box.bottom <= 0 || box.top >= top - 0.5) return [];
      const paints = style.backgroundColor !== "rgba(0, 0, 0, 0)"
        || parseFloat(style.borderTopWidth) > 0
        || [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
      if (!paints) return [];
      return [`${el.tagName}.${el.className} top=${box.top.toFixed(1)}`];
    });
  }, limit);
  expect(offenders).toEqual([]);
}
