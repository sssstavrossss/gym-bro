import { expect, test, type Page } from "@playwright/test";

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

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("home food card is quiet and hold still selects", async ({ page }) => {
  const oid = `e2e-home-food-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${oid}-oats`,
      localDate: when.today,
      timeZone: when.zone,
      time: "08:15",
      name: "Fictional morning oats",
      kcal: 400,
      protein: 20,
      fat: 8,
      carbs: 40,
    },
  })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.goto("/today");
  const card = page.locator("main.today .logc");
  await expect(card.getByRole("heading", { name: "Foods today" })).toBeVisible();
  await expect(card.getByText(/Log ·/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Select", exact: true })).toHaveCount(0);
  await expect(card.getByText(/Swipe left/)).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone39-home.png" });
  }

  const row = card.locator(".line").first();
  await row.evaluate((el) => {
    const box = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1,
      clientX: box.x + 40, clientY: box.y + 20,
    }));
  });
  await page.waitForTimeout(520);
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toBeVisible();

  await page.goto("/log");
  await expect(page.getByRole("button", { name: "Select", exact: true })).toBeVisible();
  await expect(page.getByText(/Swipe left/)).toHaveCount(0);
  await expect(page.getByText(/Target .* kcal/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Foods today" })).toHaveCount(0);
});

test("home food card shows five rows, scrolls the rest, and marks what is hidden", async ({ page }) => {
  const oid = `e2e-home-cap-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  for (let i = 0; i < 7; i++) {
    expect((await page.request.post("/api/log-entries", {
      headers: headers(oid),
      data: {
        idempotencyKey: `${oid}-${i}`, localDate: when.today, timeZone: when.zone, time: `0${i + 1}:00`,
        name: i === 2 ? "Fictional organic extra virgin olive oil from a very long catalogue name" : `Fictional food ${i + 1}`,
        kcal: 100 + i, protein: 5, fat: 2, carbs: 10,
      },
    })).ok()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.goto("/today");
  const card = page.locator("main.today .logc");
  await expect(card.getByRole("heading", { name: "Foods today" })).toBeVisible();
  await expect(card.locator(".fcount")).toHaveText("7 foods");
  const add = card.getByRole("button", { name: "Add food", exact: true });
  await expect(add).toBeVisible();
  const addBox = await add.boundingBox();
  expect(addBox && addBox.height >= 44 && addBox.width >= 44).toBeTruthy();

  const list = card.locator("[data-log-entries]");
  await expect(list.locator(".line")).toHaveCount(7);
  const rows = await list.evaluate((el) => {
    const lines = [...el.querySelectorAll(".line")].map((line) => line.getBoundingClientRect().height);
    return { client: el.clientHeight, scroll: el.scrollHeight, heights: lines };
  });
  expect(new Set(rows.heights.map(Math.round)).size).toBe(1);
  expect(rows.scroll).toBeGreaterThan(rows.client);
  const perRow = rows.scroll / 7;
  expect(Math.round(rows.client / perRow)).toBe(5);

  await expect(card.locator("[data-scroll-bar]")).toBeVisible();
  await expect(card.locator("[data-more-below]")).toBeVisible();
  await expect(card.locator(".fade.top")).toBeHidden();

  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(card.locator("[data-more-below]")).toBeHidden();
  await expect(card.locator(".fade.top")).toBeVisible();

  await add.click();
  await expect(page.getByRole("dialog", { name: "Add food" })).toBeVisible();
});
