import { expect, test, type Locator, type Page } from "@playwright/test";

const widths = [320, 390, 768, 1024, 1440, 1920] as const;

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, "element is on screen").not.toBeNull();
  return box!;
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
  });
}

test("controls keep a compact face, a 44px hit, and clear gaps", async ({ page }) => {
  const oid = `e2e-space-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  const weigh = await page.request.put(`/api/weigh-ins/${when.today}`, {
    headers,
    data: { kg: 83.6, timeZone: when.zone },
  });
  expect(weigh.ok(), await weigh.text()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  const logged = await page.request.post("/api/log-entries", {
    headers,
    data: {
      idempotencyKey: `${oid}-oats`, localDate: when.today, timeZone: when.zone, time: "08:00",
      name: "Fictional spacing oats", kcal: 400, protein: 30, fat: 5, carbs: 20,
    },
  });
  expect(logged.ok(), await logged.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  for (const width of widths) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
    await page.goto("/today");
    await expect(page.getByRole("main", { name: "Today" })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector(".scroller");
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth + 1 && (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1);
    });
    expect(overflow).toBe(true);

    const select = page.getByRole("button", { name: "Select", exact: true });
    await select.scrollIntoViewIfNeeded();
    const selectBox = await boxOf(select);
    const selectFace = await select.evaluate((el) => Number.parseFloat(getComputedStyle(el, "::before").height));
    expect(selectBox.height).toBeGreaterThanOrEqual(44);
    expect(selectBox.width).toBeGreaterThanOrEqual(44);
    expect(selectFace).toBeGreaterThan(24);
    expect(selectFace).toBeLessThan(selectBox.height - 8);
    expect(await select.evaluate((el) => getComputedStyle(el, "::before").zIndex)).toBe("-1");
    await expect(select).toHaveText("Select");

    const add = page.locator(".addrow");
    const addBox = await boxOf(add);
    const plus = await boxOf(add.locator(".addc"));
    expect(addBox.height).toBeGreaterThanOrEqual(44);
    expect(plus.height).toBeLessThanOrEqual(26);
    expect(plus.width).toBeLessThanOrEqual(26);
    expect(overlaps(selectBox, addBox)).toBe(false);

    const info = page.getByRole("button", { name: "What is the trend?" });
    await info.scrollIntoViewIfNeeded();
    const infoBox = await boxOf(info);
    expect(infoBox.width).toBeGreaterThanOrEqual(44);
    expect(infoBox.height).toBeGreaterThanOrEqual(44);
    const number = page.locator(".wcard .t-nm, .wbig .t-nm").first();
    expect(overlaps(infoBox, await boxOf(number))).toBe(false);
    const weightChip = page.locator(".wbig .chip, .wcard .chip").first();
    if (await weightChip.count()) expect(overlaps(infoBox, await boxOf(weightChip))).toBe(false);

    if (width >= 1024) {
      const aside = page.locator("aside.side");
      const asideBox = await boxOf(aside);
      const glance = await boxOf(aside.locator(".glance"));
      const keys = aside.locator(".keys kbd");
      const count = await keys.count();
      expect(count).toBeGreaterThanOrEqual(5);
      const keyBoxes: Box[] = [];
      for (let i = 0; i < count; i++) keyBoxes.push(await boxOf(keys.nth(i)));
      for (const key of keyBoxes) {
        expect(key.x).toBeGreaterThanOrEqual(asideBox.x + 8);
        expect(key.x + key.width).toBeLessThanOrEqual(asideBox.x + asideBox.width - 8);
        expect(key.y).toBeGreaterThanOrEqual(glance.y + glance.height + 8);
        expect(key.y + key.height).toBeLessThanOrEqual(asideBox.y + asideBox.height - 4);
      }
      for (let i = 0; i < keyBoxes.length; i++) {
        for (let j = i + 1; j < keyBoxes.length; j++) expect(overlaps(keyBoxes[i], keyBoxes[j])).toBe(false);
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).blur();
  await expect(food.getByRole("heading", { name: "Add food" })).toBeVisible();
  const close = food.getByRole("button", { name: "Close", exact: true });
  const closeBox = await boxOf(close);
  const closeFace = await close.evaluate((el) => Number.parseFloat(getComputedStyle(el, "::before").width));
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  expect(closeFace).toBeLessThanOrEqual(34);
  const time = food.locator(".tchip");
  const timeBox = await boxOf(time);
  expect(timeBox.height).toBeLessThanOrEqual(34);
  expect(timeBox.height).toBeGreaterThanOrEqual(28);
  const chip = food.getByRole("button", { name: /All foods/ });
  const chipBox = await boxOf(chip);
  const chipFace = await chip.evaluate((el) => Number.parseFloat(getComputedStyle(el, "::before").height));
  expect(chipBox.height).toBeGreaterThanOrEqual(44);
  expect(chipFace).toBeLessThan(chipBox.height - 8);
  expect(overlaps(closeBox, timeBox)).toBe(false);
});
