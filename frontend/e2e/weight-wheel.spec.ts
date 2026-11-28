import { expect, test, type Page } from "@playwright/test";
import { pick } from "./dial";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    const day = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return format.format(date);
    };
    return { zone, today: day(0), yesterday: day(-1), earlier: day(-3) };
  });
}

async function seed(page: Page, oid: string) {
  const request = page.request;
  const when = await clock(page);
  for (const [date, kg] of [[when.earlier, 84], [when.yesterday, 83.6]] as const) {
    const response = await request.put(`/api/weigh-ins/${date}`, { headers: headers(oid), data: { kg, timeZone: when.zone } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const profile = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  return when;
}

async function openSheet(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  await page.getByRole("button", { name: /Open weight|Log weight|Weigh in/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Log weight" });
  await expect(sheet.getByRole("heading", { name: "Log weight" })).toBeVisible();
  return sheet;
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the weight sheet picks on the number wheel, nudges a tenth, and previews on the chart", async ({ page }) => {
    const oid = `e2e-wwheel-${Date.now()}-${test.info().project.name}`;
    const when = await seed(page, oid);
    const sheet = await openSheet(page, oid);
    // No field and no keypad on a phone: the number is a button that opens the wheel.
    await expect(sheet.getByRole("group", { name: "Number keypad" })).toHaveCount(0);
    await expect(sheet.getByRole("textbox")).toHaveCount(0);
    const figure = sheet.locator("[data-weight-pick]");
    // Opening must not leave the hidden text proxy focused: on iOS that raises the letter keyboard over the sheet.
    expect(await page.evaluate(() => document.activeElement?.classList.contains("kb-proxy") ?? false)).toBe(false);
    // Nothing picked yet: the last weigh-in, in grey.
    await expect(figure).toHaveText("83.6");
    await expect(figure).toHaveClass(/hinted/);
    await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(sheet.locator("[data-preview]")).toHaveCount(0);

    // Everything fits on an iPhone 15 without scrolling the sheet.
    const overflow = await sheet.locator(".sheet-body").evaluate((node) => ({
      down: node.scrollHeight - node.clientHeight,
      side: node.scrollWidth - node.clientWidth,
    }));
    expect(overflow.down).toBeLessThanOrEqual(1);
    expect(overflow.side).toBeLessThanOrEqual(1);
    await expect(sheet.getByRole("region", { name: "Last 30 days" })).toBeVisible();
    await expect(sheet.locator("[data-trend-line]")).toContainText(/^Trend \d+\.\d kg/);

    // − with nothing picked steps from the last weigh-in.
    await sheet.getByRole("button", { name: "0.1 kg less" }).click();
    await expect(figure).toHaveText("83.5");

    // The wheel opens on the number shown, in tenths, and says how far it sits from the trend as it turns.
    await figure.click();
    const dial = page.locator("[data-dial]");
    await expect(dial).toHaveAttribute("aria-label", "Weight");
    await expect(dial.locator("[data-dial-value]")).toHaveText("83.5kg");
    await expect(dial.locator('[data-dial-step="0.1"]')).toHaveAttribute("aria-pressed", "true");
    await expect(dial.locator("[data-dial-live]")).toHaveText(/\d+\.\d kg (under|over) trend|on the trend/);
    await page.keyboard.press("Escape");
    await expect(dial).toHaveCount(0);
    await expect(figure).toHaveText("83.5");

    await pick(page, figure, "82.4");
    await expect(figure).toHaveText("82.4");
    await expect(figure).not.toHaveClass(/hinted/);
    await expect(sheet.getByText(/Last weigh-in 83\.6 kg yesterday · \d+\.\d kg under trend/)).toBeVisible();
    await expect(sheet.locator("[data-preview]")).toHaveCount(1);
    await sheet.getByRole("button", { name: "0.1 kg more" }).click();
    await expect(figure).toHaveText("82.5");

    const save = sheet.getByRole("button", { name: "Save 82.5 kg" });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(sheet).toHaveCount(0);
    const saved = await (await page.request.get(`/api/weigh-ins?from=${when.today}&to=${when.today}`, { headers: headers(oid) })).json();
    expect(saved.weighIns[0].kg).toBe(82.5);

    // Reopened, the hint says what a new number would replace.
    const again = await openSheet(page, oid);
    await expect(again.getByText("Today's weigh-in is 82.5 kg · saving replaces it")).toBeVisible();
    await again.getByRole("button", { name: "0.1 kg more" }).click();
    await expect(again.getByText(/^Replaces today's 82\.5 kg/)).toBeVisible();
  });
});

test("with a keyboard the weight sheet types in its field", async ({ page }) => {
  test.skip(!(await page.evaluate(() => matchMedia("(hover: hover)").matches)), "This browser reports no hover.");
  await page.setViewportSize({ width: 1280, height: 900 });
  const oid = `e2e-wkeys-${Date.now()}-${test.info().project.name}`;
  await seed(page, oid);
  const sheet = await openSheet(page, oid);
  const field = sheet.getByRole("textbox", { name: "Weight in kilograms" });
  await expect(sheet.locator("[data-weight-pick]")).toHaveCount(0);
  await expect(field).toHaveAttribute("inputmode", "decimal");
  await field.fill("82.4");
  await expect(sheet.getByRole("button", { name: "Save 82.4 kg" })).toBeEnabled();
  await expect(sheet.locator("[data-preview]")).toHaveCount(1);
});
