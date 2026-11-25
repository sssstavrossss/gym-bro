import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** A profiled user with no food logged. The Progress card starts on `startPage` (an index in its pages). */
async function setup(page: Page, startPage: number) {
  const oid = `e2e-card-pages-${Date.now()}-${test.info().project.name}`;
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
  await page.addInitScript(({ id, start }) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    // Set once; a reload keeps what the test picked.
    if (sessionStorage.getItem("gymbro-e2e-kept")) return;
    sessionStorage.setItem("gymbro-e2e-kept", "1");
    localStorage.setItem("gymbro-home-progress-page", String(start));
  }, { id: oid, start: startPage });
  return oid;
}

async function savedProfile(page: Page, oid: string) {
  return (await (await page.request.get("/api/profile", { headers: headers(oid) })).json()).profile;
}

test("the Progress cog hides pages, keeps the page you're on, and remembers the choice", async ({ page }) => {
  await page.goto("/");
  await setup(page, 5);
  await page.goto("/today");

  const progress = page.getByRole("region", { name: "Progress", exact: true });
  const title = progress.locator("[data-progress-title]");
  await expect(title).toHaveText("Fibre");
  // Nine pages: the dots only show where you are.
  await expect(progress.locator(".strip")).toHaveClass(/halves/);
  await expect(progress.getByRole("button", { name: "Calories", exact: true })).toHaveCount(0);

  await progress.getByRole("button", { name: "Choose progress pages" }).click();
  const sheet = page.getByRole("dialog", { name: "Progress pages" });
  await expect(sheet).toBeVisible();
  const weight = sheet.getByRole("switch", { name: /Weight/ });
  await expect(weight).toBeDisabled();
  await expect(weight).toHaveAttribute("aria-checked", "true");
  for (const name of ["Fat", "Carbs", "Saturated fat", "Burn"]) {
    const toggle = sheet.getByRole("switch", { name: new RegExp(`^${name}`) });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
  // Pages before Fibre went, and the card stays on Fibre.
  await expect(title).toHaveText("Fibre");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  // Five pages fit, so each dot is a button again.
  await expect(progress.locator(".strip")).not.toHaveClass(/halves/);
  const dots = progress.locator(".dot");
  await expect(dots).toHaveCount(5);
  await expect(progress.locator(".ppage")).toHaveCount(5);
  await progress.getByRole("button", { name: "Calories", exact: true }).click();
  await expect(title).toHaveText("Calories");
  await expect(progress.getByRole("button", { name: "Calories", exact: true })).toHaveAttribute("aria-current", "true");

  // Hiding the page you're on sends the card to Weight.
  await progress.getByRole("button", { name: "Choose progress pages" }).click();
  await sheet.getByRole("switch", { name: /^Calories/ }).click();
  await expect(title).toHaveText("Weight");
  await sheet.getByRole("button", { name: "Close" }).click();

  const stored = await page.evaluate(() => localStorage.getItem("gymbro-home-progress-hidden"));
  expect(JSON.parse(stored ?? "[]")).toEqual(["kcal", "fat", "carbs", "saturatedFat", "burn"]);

  await page.reload();
  await expect(title).toHaveText("Weight");
  await expect(progress.locator(".ppage")).toHaveCount(4);
  await expect(progress.getByRole("button", { name: "Fat", exact: true })).toHaveCount(0);
  await progress.getByRole("button", { name: "Sodium", exact: true }).click();
  await expect(title).toHaveText("Sodium");
});

test("the Macros card cog hides nutrient panels, and Macros always stays", async ({ page }) => {
  await page.goto("/");
  await setup(page, 0);
  await page.goto("/today");

  const card = page.locator("[data-nutrient-card]");
  const dots = card.locator(".dot");
  await expect(dots).toHaveCount(5);
  // The gear's right edge meets the card's content edge, where the bars end.
  const edges = await card.evaluate((el) => {
    const gear = el.querySelector(".cog svg")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { gear: gear.right, content: box.right - parseFloat(getComputedStyle(el).paddingRight) };
  });
  expect(Math.abs(edges.gear - edges.content)).toBeLessThan(1);

  await card.getByRole("button", { name: "Choose macros card pages" }).click();
  const sheet = page.getByRole("dialog", { name: "Macros card pages" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("switch", { name: /^Macros/ })).toBeDisabled();
  await sheet.getByRole("switch", { name: /^Vitamins/ }).click();
  await sheet.getByRole("switch", { name: /^Minerals/ }).click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await expect(dots).toHaveCount(3);
  await card.getByRole("button", { name: "Panel 3 of 3" }).click();
  await expect(card.getByRole("button", { name: "Panel 3 of 3" })).toHaveAttribute("aria-current", "true");
  await expect(card.getByRole("img", { name: /^Carbs 0 g: sugars/ })).toBeInViewport();

  await page.reload();
  await expect(dots).toHaveCount(3);
  // With every panel off, the dots go and the cog stays.
  await card.getByRole("button", { name: "Choose macros card pages" }).click();
  await sheet.getByRole("switch", { name: /^Fats/ }).click();
  await sheet.getByRole("switch", { name: /^Carbs/ }).click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(dots).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Choose macros card pages" })).toBeVisible();
  await expect(card.getByText("Calories").first()).toBeVisible();
});

test("pages move by keyboard and by drag, off pages keep their place, and the order follows the account", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page, 0);
  await page.goto("/today");

  const progress = page.getByRole("region", { name: "Progress", exact: true });
  await progress.getByRole("button", { name: "Choose progress pages" }).click();
  const sheet = page.getByRole("dialog", { name: "Progress pages" });
  const rows = sheet.locator("[data-page-row]");
  const order = () => rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-page-row")));
  await expect(sheet.locator("[data-reset-order]")).toHaveCount(0);

  // ↑ on Burn's handle walks it up to second; focus stays on the handle and the move is read out.
  const burnGrip = sheet.locator('[data-page-row="burn"] [data-page-grip]');
  await burnGrip.focus();
  for (let i = 0; i < 7; i += 1) await page.keyboard.press("ArrowUp");
  await expect(burnGrip).toBeFocused();
  await expect(burnGrip).toHaveAttribute("aria-label", "Move Burn, 2 of 9");
  await expect(sheet.locator("[aria-live]")).toHaveText("Burn, 2 of 9");
  expect(await order()).toEqual(["weight", "burn", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);

  // Weight moves too: drag its handle below Burn. Both boxes are read in one frame, once the sheet is still.
  await sheet.locator('[data-page-row="weight"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const at = await sheet.evaluate((el) => {
    const grip = el.querySelector('[data-page-row="weight"] [data-page-grip]')!.getBoundingClientRect();
    const burn = el.querySelector('[data-page-row="burn"]')!.getBoundingClientRect();
    return { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2, to: burn.y + burn.height * 0.9 };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.to, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).toEqual(["burn", "weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);

  // Switched off, Calories keeps its place, dimmed.
  await sheet.getByRole("switch", { name: /^Calories/ }).click();
  await expect(sheet.locator('[data-page-row="kcal"]')).toHaveClass(/off/);
  expect(await order()).toEqual(["burn", "weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);
  await sheet.getByRole("button", { name: "Close" }).click();

  const pages = () => progress.locator(".ppage").evaluateAll((all) => all.map((item) => item.getAttribute("data-page")));
  await expect.poll(pages).toEqual(["burn", "weight", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);
  await expect.poll(async () => (await savedProfile(page, oid)).progressOrder)
    .toEqual(["burn", "weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);

  await page.reload();
  await expect.poll(pages).toEqual(["burn", "weight", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);

  // Reset order puts the default back and leaves Calories off.
  await progress.getByRole("button", { name: "Choose progress pages" }).click();
  await sheet.locator("[data-reset-order]").click();
  await expect(sheet.locator("[data-reset-order]")).toHaveCount(0);
  expect(await order()).toEqual(["weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium", "burn"]);
  await expect(sheet.getByRole("switch", { name: /^Calories/ })).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await savedProfile(page, oid)).progressOrder).toEqual([]);
});

test("a panel moved before Macros is where the Macros card opens", async ({ page }) => {
  await page.goto("/");
  await setup(page, 0);
  await page.goto("/today");

  const card = page.locator("[data-nutrient-card]");
  await card.getByRole("button", { name: "Choose macros card pages" }).click();
  const sheet = page.getByRole("dialog", { name: "Macros card pages" });
  await sheet.locator('[data-page-row="fats"] [data-page-grip]').focus();
  await page.keyboard.press("ArrowUp");
  await expect(sheet.locator('[data-page-row="fats"] [data-page-grip]')).toHaveAttribute("aria-label", "Move Fats, 1 of 5");
  await sheet.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(card.getByRole("button", { name: "Panel 1 of 5" })).toHaveAttribute("aria-current", "true");
  await card.getByRole("button", { name: "Panel 2 of 5" }).click();
  await expect(card.getByText("Calories").first()).toBeInViewport();
});
