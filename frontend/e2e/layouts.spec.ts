import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const widths = [375, 768, 1024, 1280, 1920] as const;

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

async function logQuick(request: APIRequestContext, oid: string, date: string, zone: string, name: string, kcal: number) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${oid}-${name}`,
      localDate: date,
      timeZone: zone,
      time: "12:30",
      name,
      kcal,
      protein: 30,
      fat: 10,
      carbs: 40,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const nodes = [document.documentElement, document.querySelector(".app"), document.querySelector(".scroller")];
    return nodes.every((node) => !node || node.scrollWidth <= node.clientWidth + 1);
  });
  expect(overflow).toBe(true);
}

async function expectClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((item) => ({
    id: item.id,
    impact: item.impact,
    nodes: item.nodes.slice(0, 3).map((node) => node.html),
  })))).toEqual([]);
}

function layoutName(width: number): string {
  if (width >= 1280) return "three";
  if (width >= 1024) return "two";
  if (width >= 600) return "tablet";
  return "phone";
}

test("layouts stay in one column of scrolling from 375 to 1,920", async ({ page }) => {
  const oid = `e2e-layout-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await logQuick(page.request, oid, when.today, when.zone, "Fictional layout bar", 450);
  await sign(page, oid);

  let eaten = "";
  let dayTotal = "";
  let profileKcal = "";
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.locator(".app")).toHaveAttribute("data-layout", layoutName(width));
    const card = page.getByRole("group", { name: /kcal/ });
    await expect(card).toBeVisible();
    await expectNoSideScroll(page);

    const kcal = (await card.getAttribute("aria-label")) ?? "";
    if (!eaten) eaten = kcal;
    else expect(kcal).toBe(eaten);

    if (width < 600) {
      await expect(page.locator("nav.tabbar")).toBeVisible();
      await expect(page.locator("aside.side")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "This week" })).toHaveCount(0);
      await expect(page.locator(".wbig")).toHaveCount(0);
    } else if (width < 1024) {
      await expect(page.locator("nav.tabbar")).toBeVisible();
      await expect(page.locator("aside.side")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "This week" })).toHaveCount(0);
      await expect(page.locator(".wbig")).toBeVisible();
      await expect(page.getByText("Fictional layout bar")).toBeVisible();
    } else {
      await expect(page.locator("nav.tabbar")).toHaveCount(0);
      const side = page.locator("aside.side");
      await expect(side).toBeVisible();
      const box = await side.boundingBox();
      expect(box?.width).toBeCloseTo(240, 0);
      await expect(side).toContainText(/N/);
      await expect(side).toContainText("quick add");
      await expect(side).toContainText("Esc");
      const add = await side.getByRole("button", { name: /Add food/ }).boundingBox();
      expect(add!.width).toBeGreaterThanOrEqual(44);
      expect(add!.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
      await expect(page.locator(".wrow[aria-pressed='true']")).toContainText("450");
      await expect(page.getByText("Fictional layout bar")).toBeVisible();
      const row = page.locator(".wrow").first();
      const rowBox = await row.boundingBox();
      expect(rowBox!.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".today")).toHaveClass(width >= 1280 ? /three/ : /two/);
    }

    if (width === 1280 || width === 768) await expectClean(page);

    await page.goto("/log");
    await expect(page.getByRole("heading", { name: "Log", exact: true })).toBeVisible();
    await expect(page.locator(".summary")).toContainText("450");
    await expectNoSideScroll(page);
    const total = (await page.locator(".summary").innerText()).replace(/\s+/g, " ").trim();
    if (!dayTotal) dayTotal = total;
    else expect(total).toBe(dayTotal);
    await expect(page.getByRole("checkbox", { name: /Fasting day/ })).toBeVisible();

    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Progress", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "30 days" })).toHaveAttribute("aria-checked", "true");
    await expectNoSideScroll(page);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
    const field = (await page.locator("[data-field=kcal]").innerText()).trim();
    if (!profileKcal) profileKcal = field;
    else expect(field).toBe(profileKcal);
    await expectNoSideScroll(page);
  }
});

test("desktop shortcuts, escape, and the right-hand panel", async ({ page }) => {
  const oid = `e2e-keys-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await sign(page, oid);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

  const add = page.locator("aside.side").getByRole("button", { name: /Add food/ });
  await add.focus();
  await page.keyboard.press("n");
  const food = page.getByRole("dialog", { name: "Add food" });
  await expect(food).toBeVisible();
  await expect(food.locator(".sheet")).toBeVisible();
  const panel = await food.locator(".sheet").boundingBox();
  expect(panel!.x).toBeGreaterThan(1280 / 2);
  expect(panel!.width).toBeLessThanOrEqual(480);

  const search = food.getByRole("searchbox", { name: "Search foods" });
  await search.click();
  await search.fill("");
  await page.keyboard.type("n");
  await expect(search).toHaveValue("n");
  await expect(page.getByRole("dialog", { name: "Log weight" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(food).toHaveCount(0);
  await expect(add).toBeFocused();

  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Add food" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("q");
  await expect(page.getByRole("radio", { name: "Quick Add" })).toBeChecked();
  const name = page.getByRole("dialog", { name: "Add food" }).getByRole("textbox", { name: "Name (optional)" });
  await name.click();
  await page.keyboard.press("w");
  await expect(name).toHaveValue(/w/i);
  await expect(page.getByRole("dialog", { name: "Log weight" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add food" })).toHaveCount(0);
  await expect(add).toBeFocused();

  await page.keyboard.press("w");
  const weight = page.getByRole("dialog", { name: "Log weight" });
  await expect(weight).toBeVisible();
  const weightPanel = await weight.locator(".sheet").boundingBox();
  expect(weightPanel!.x).toBeGreaterThan(1280 / 2);
  await page.keyboard.press("Escape");
  await expect(weight).toHaveCount(0);

  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "Add food" })).toBeVisible();
  for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const active = document.activeElement;
    return !!dialog && !!active && (dialog.contains(active) || !!active.closest(".toast"));
  });
  expect(trapped).toBe(true);
  await expectClean(page);

  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Profile" }).click();
  const year = page.getByRole("textbox", { name: "Birth year" });
  await year.focus();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("w");
  await expect(page.getByRole("dialog", { name: "Log weight" })).toHaveCount(0);
});

test("a tablet sheet is centred", async ({ page }) => {
  const oid = `e2e-tablet-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await sign(page, oid);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Log today's weigh-in/ }).click();
  const sheet = page.getByRole("dialog", { name: "Log weight" }).locator(".sheet");
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.width).toBeLessThan(768 - 20);
  expect(box!.x).toBeGreaterThan(8);
  expect(Math.abs(box!.x + box!.width / 2 - 384)).toBeLessThan(12);
  await expectNoSideScroll(page);
  await expectClean(page);
});

test.describe("touch at desktop width", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

test("a touch screen at desktop width keeps swipe and the keypad", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Touch media emulation is checked in Chromium");
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const list = original(query);
      const text = query.replace(/\s/g, "");
      if (!text.includes("hover:hover") || !text.includes("pointer:fine")) return list;
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      } as MediaQueryList;
    };
  });
  const oid = `e2e-touchdesk-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await logQuick(page.request, oid, when.today, when.zone, "Fictional touch bar", 320);
  await sign(page, oid);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  const coarse = await page.evaluate(() => ({
    hover: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    layout: document.querySelector(".app")?.getAttribute("data-layout"),
  }));
  expect(coarse.hover).toBe(false);
  expect(coarse.layout).toBe("three");
  await expect(page.locator("aside.side")).toBeVisible();
  await expect(page.getByText(/Swipe left/)).toBeVisible();
  await expect(page.locator(".hacts")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy Fictional touch bar to another day" })).toBeAttached();

  await page.locator("aside.side").getByRole("button", { name: /Add food/ }).click();
  await page.getByRole("radio", { name: "Quick Add" }).click();
  await expect(page.getByRole("group", { name: "Number keypad" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Calories", exact: true })).toHaveCount(0);
  await expectNoSideScroll(page);
});
});
