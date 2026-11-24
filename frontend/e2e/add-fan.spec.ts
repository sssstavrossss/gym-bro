import AxeBuilder from "@axe-core/playwright";
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

async function setUp(request: APIRequestContext, oid: string, today: string, zone: string) {
  const weighIn = await request.put(`/api/weigh-ins/${today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: zone } });
  expect(weighIn.ok(), await weighIn.text()).toBeTruthy();
  const profile = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose", rateKgPerWeek: 0.5, goalWeightKg: 80,
      proteinSetting: "normal", proteinGramsPerKg: 2, fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
}

const pageOne = ["Search", "Scan", "Describe", "Quick add", "Weight"];
const pageTwo = ["New recipe", "New food", "Recipes", "My foods", "Groups"];

test("the + opens a fan of five, with more pages that roll in and wrap", async ({ page }) => {
  const oid = `e2e-fan-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await setUp(page.request, oid, when.today, when.zone);
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");

  const fan = page.getByRole("dialog", { name: "Add" });
  const shown = (labels: string[]) => Promise.all(labels.map((label) => expect(fan.getByRole("button", { name: label, exact: true })).toBeVisible()));
  const gone = (labels: string[]) => Promise.all(labels.map((label) => expect(fan.getByRole("button", { name: label, exact: true })).toHaveCount(0)));

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await shown(pageOne);
  await gone(pageTwo);
  await expect(fan.getByRole("button", { name: "Page 1 of 2" })).toHaveAttribute("aria-current", "true");

  // The buttons sit on a half ring above the +, first on the left, the middle one highest, all on screen.
  const plus = (await fan.getByRole("button", { name: "Close" }).boundingBox())!;
  const boxes = await Promise.all(pageOne.map(async (label) => (await fan.getByRole("button", { name: label, exact: true }).boundingBox())!));
  const centres = boxes.map((box) => box.x + box.width / 2);
  expect([...centres].sort((a, b) => a - b)).toEqual(centres);
  expect(boxes[2].y).toBeLessThan(boxes[0].y);
  for (const box of boxes) {
    expect(box.y + box.height).toBeLessThan(plus.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Neighbours never overlap: neither disc touches the other's disc or label, so a tap lands on the one you meant.
  type Box = { left: number; right: number; top: number; bottom: number };
  const touch = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const clear = async (why: string) => {
    const parts = await fan.locator(".fi.here").evaluateAll((items) => items.map((item) => [".fdisc", ".lbl"].map((part) => {
      const r = item.querySelector(part)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    })));
    for (let at = 1; at < parts.length; at += 1) {
      for (const a of parts[at - 1]) for (const b of parts[at]) expect(touch(a, b), `${why}: ${pageOne[at - 1]} and ${pageOne[at]} overlap`).toBeFalsy();
    }
  };
  await clear("usual text");
  // At the largest text size the labels stop growing at 13px, so they still clear.
  await page.evaluate(() => { document.documentElement.style.fontSize = "53px"; });
  await clear("largest text");
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });

  // → rolls to page two, → again wraps back to page one, ← wraps to page two.
  await page.keyboard.press("ArrowRight");
  await shown(pageTwo);
  await gone(pageOne);
  await page.keyboard.press("ArrowRight");
  await shown(pageOne);
  await page.keyboard.press("ArrowLeft");
  await shown(pageTwo);
  await fan.getByRole("button", { name: "Page 1 of 2" }).click();
  await shown(pageOne);

  // A sideways swipe turns the page and doesn't close the fan.
  const box = (await fan.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 310, { steps: 6 });
  await page.mouse.up();
  await shown(pageTwo);

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => item.id))).toEqual([]);

  // My foods opens Add food on its page.
  await fan.getByRole("button", { name: "My foods", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await expect(food.getByRole("group", { name: "Show" }).getByRole("button", { name: /^My foods/ })).toHaveAttribute("aria-pressed", "true");
  await expect(food.getByRole("button", { name: /^New food/ })).toBeVisible();
  await food.getByRole("button", { name: "Close" }).click();
  await expect(food).toHaveCount(0);

  // New food opens the form, over My foods.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await fan.getByRole("button", { name: "New food", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New food" })).toBeVisible();
  await page.goto("/today");

  // Each time it opens on page one. Tapping the dim, or the × over the +, closes it.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await shown(pageOne);
  await fan.getByRole("button", { name: "Close" }).click();
  await expect(fan).toHaveCount(0);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.mouse.click(20, 120);
  await expect(fan).toHaveCount(0);
});
