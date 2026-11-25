import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

/** Waits for the sheet's slide-in (and any other finite animation in it) to end before measuring or clicking. */
async function settled(dialog: Locator) {
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true })
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}

/** A profiled user on Today, with showPicker counted instead of opening a picker. */
async function setup(page: Page) {
  const oid = `e2e-time-chip-${Date.now()}-${test.info().project.name}`;
  await page.goto("/");
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    const counter = window as unknown as { pickerCalls: number };
    counter.pickerCalls = 0;
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      configurable: true,
      writable: true,
      value() { counter.pickerCalls += 1; },
    });
  }, oid);
  await page.goto("/today");
  if (page.viewportSize()!.width < 500) {
    // Phone: the tab bar's Add, then Search on the fan.
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Search", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Add food" }).first().click();
  }
  const food = page.getByRole("dialog", { name: "Add food" });
  await expect(food).toBeVisible();
  // A press that starts while the sheet still slides in can end off the input, and no click reaches it.
  await settled(food);
  return food.getByLabel(/Change time/);
}

const pickerCalls = (page: Page) => page.evaluate(() => (window as unknown as { pickerCalls: number }).pickerCalls);

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a tap opens the time picker once and doesn't ask again", async ({ page }) => {
    const time = await setup(page);
    // Touching down alone opens nothing. Opened under the finger, the iOS 26 picker took the
    // lift as a tap outside and closed. A long press, which never lifts as a tap, kept it open.
    await time.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect(time).not.toBeFocused();
    await time.tap();
    // The tap focused the input, which opens the picker on a phone. A second ask
    // (showPicker) closed it again on iOS 26.
    expect(await pickerCalls(page)).toBe(0);
    expect(await time.inputValue()).toMatch(/^\d{2}:\d{2}$/);
    if (test.info().project.name === "chromium") await expect(time).toBeFocused();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a click that didn't start with a touch asks for the picker", async ({ page }) => {
    const time = await setup(page);
    // A real mouse press on a native time field goes into the browser's own field (and, at its right
    // end, its own picker) in ways that differ between machines. The click event alone is what the
    // chip handles: without a touch press before it, the chip asks for the picker.
    await time.dispatchEvent("click");
    expect(await pickerCalls(page)).toBe(1);
    expect(await time.inputValue()).toMatch(/^\d{2}:\d{2}$/);
  });
});
