import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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

async function createFood(request: APIRequestContext, oid: string, name: string) {
  const response = await request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name,
      kcalPer100: 100,
      proteinPer100: 10,
      fatPer100: 1,
      carbsPer100: 2,
      basis: "g",
      nutrientBasis: "per_100",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function logQuick(request: APIRequestContext, oid: string, date: string, zone: string, name: string, time: string, kcal: number) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${name}-${time}`,
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

async function fieldsAtLeast16(root: Locator) {
  const small = await root.locator("input, textarea, select").evaluateAll((nodes) => nodes
    .map((node) => ({
      label: node.getAttribute("aria-label") || (node as HTMLInputElement).placeholder || node.tagName,
      font: parseFloat(getComputedStyle(node).fontSize),
    }))
    .filter((field) => !(field.font >= 16)));
  expect(small).toEqual([]);
}

/** Text fields select the value. Numeric fields park the caret at the end and replace on the first key, with no highlight. */
async function expectReplace(page: Page, field: Locator, typed: string, mode: "select" | "caret" = "select") {
  await expect(field).toBeVisible();
  if (mode === "caret") {
    const active = await field.evaluate((el) => document.activeElement === el);
    if (!active) await field.click();
  }
  await expect(field).toBeFocused();
  const selection = await field.evaluate((node) => {
    const input = node as HTMLInputElement;
    return { start: input.selectionStart, end: input.selectionEnd, length: input.value.length, mode: input.dataset.replace ?? "" };
  });
  if (mode === "caret") {
    expect(selection.start).toBe(selection.end);
  } else {
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.length);
  }
  await page.keyboard.type(typed);
  await expect(field).toHaveValue(typed);
}

async function openAddFood(page: Page) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  await expect(page.getByRole("dialog", { name: "Add food" })).toBeVisible();
}

for (const width of [375, 390]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: width === 375 ? 667 : 844 }, hasTouch: true, isMobile: true });

    test("each form focuses its primary field, selects the value, and stays at least 16px", async ({ page }) => {
      test.setTimeout(90_000);
      const oid = `e2e-focus-${width}-${Date.now()}-${test.info().project.name}`;
      const foodName = `Focusoats ${width}`;
      const when = await clock(page);
      await putWeighIn(page.request, oid, when.today, when.zone);
      await putProfile(page.request, oid, when.zone);
      await createFood(page.request, oid, foodName);
      await logQuick(page.request, oid, when.today, when.zone, "Morning oats", "08:00", 200);
      await logQuick(page.request, oid, when.today, when.zone, "Morning broth", "12:00", 80);
      await sign(page, oid);
      await page.goto("/today");

      await openAddFood(page);
      const food = page.getByRole("dialog", { name: "Add food" });
      const filters = food.getByRole("group", { name: "Show" });
      await expect(filters.getByRole("button", { name: "New food" })).toHaveCount(0);
      await expect(filters.getByRole("button", { name: "New recipe" })).toHaveCount(0);
      const search = food.getByRole("searchbox", { name: "Search foods" });
      await expect(search).toBeFocused();
      await expect(filters).toBeHidden();
      await search.blur();
      if (width === 390 && test.info().project.name === "chromium") {
        await expect(filters.getByRole("button", { name: "All foods" })).toBeVisible();
        await page.screenshot({ path: "/opt/cursor/artifacts/add-food-chooser-phone.png" });
      }
      await search.focus();
      await expectReplace(page, search, "zz");
      await fieldsAtLeast16(food);
      await search.blur();

      await food.getByRole("radio", { name: "Quick Add" }).click();
      await expectReplace(page, food.getByRole("textbox", { name: "Name (optional)" }), "Bar");
      await fieldsAtLeast16(food);

      await food.getByRole("radio", { name: "Search" }).click();
      await expect(search).toBeFocused();
      await search.fill(foodName);
      await food.getByRole("button", { name: new RegExp(foodName) }).click();
      const amount = food.getByRole("textbox", { name: "Amount in g" });
      await expectReplace(page, amount, "55", "caret");
      await fieldsAtLeast16(food);

      await food.getByRole("button", { name: "Serving" }).click();
      await expectReplace(page, food.getByRole("textbox", { name: "Serving name" }), "cup");

      const time = food.getByLabel(/Change time/);
      await time.click();
      const timeState = await time.evaluate((node) => {
        const input = node as HTMLInputElement;
        return {
          active: document.activeElement === input,
          value: input.value,
          font: parseFloat(getComputedStyle(input).fontSize),
        };
      });
      expect(timeState.font).toBeGreaterThanOrEqual(16);
      // WebKit's native time control takes focus into the picker and does not
      // leave the input as document.activeElement. The tap still focuses it
      // first (pointerdown) and primes a value. Chromium keeps the input focused.
      if (test.info().project.name === "webkit") expect(timeState.value).toMatch(/^\d{2}:\d{2}$/);
      else expect(timeState.active).toBe(true);

      await food.getByRole("button", { name: "Back" }).click();
      await search.blur();
      await food.getByRole("button", { name: /My foods/ }).click();
      await search.fill("");
      await search.blur();
      await food.getByRole("button", { name: "New food" }).click();
      const editor = page.getByRole("dialog", { name: "New food" });
      await expectReplace(page, editor.getByRole("textbox", { name: /^Name/ }), "Stew");
      await fieldsAtLeast16(editor);
      await editor.getByRole("button", { name: "Back" }).click();
      await food.getByRole("button", { name: "Close" }).click();

      await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
      const weight = page.getByRole("dialog", { name: "Log weight" });
      await expectReplace(page, weight.getByRole("textbox", { name: "Weight in kilograms" }), "70", "caret");
      await fieldsAtLeast16(weight);
      await weight.getByRole("button", { name: "Close" }).click();

      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
      await food.getByRole("searchbox", { name: "Search foods" }).blur();
      await food.getByRole("button", { name: /Recipes/ }).click();
      await expect(food.getByRole("button", { name: "New recipe" })).toBeVisible();
      await food.getByRole("button", { name: "New recipe" }).click();
      const recipe = page.getByRole("dialog", { name: "New recipe" });
      await expectReplace(page, recipe.getByRole("textbox", { name: "Recipe name" }), "Soup");
      await fieldsAtLeast16(recipe);
      await recipe.getByRole("button", { name: "Add ingredient" }).click();
      const ingredientSearch = recipe.getByRole("searchbox", { name: "Search foods" });
      await expectReplace(page, ingredientSearch, foodName);
      await recipe.getByRole("button", { name: new RegExp(foodName) }).click();
      await expectReplace(page, recipe.getByRole("textbox", { name: `Amount of ${foodName}` }), "40", "caret");
      await recipe.getByRole("button", { name: "Add to recipe" }).click();
      await expect(recipe.getByRole("textbox", { name: "Recipe name" })).toBeFocused();
      await fieldsAtLeast16(recipe);
      const summaryAlign = await recipe.locator(".metric").evaluateAll((nodes) => nodes.map((node) => {
        const figure = node.querySelector(".t-nm");
        const label = node.querySelector(".t-label");
        return {
          figure: figure ? getComputedStyle(figure).textAlign : "",
          label: label ? getComputedStyle(label).textAlign : "",
        };
      }));
      expect(summaryAlign.every((item) => item.figure === "left" && item.label === "left")).toBe(true);
      await expect(recipe.locator(".metric").nth(1).locator(".t-nm")).toHaveText("–");
      if (width === 390 && test.info().project.name === "chromium") {
        await recipe.locator("[data-ingredient-index='0']").scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/opt/cursor/artifacts/recipe-sheet-phone.png" });
        await recipe.locator(".sum").screenshot({ path: "/opt/cursor/artifacts/recipe-summary-phone.png" });
      }
      await recipe.getByRole("button", { name: "Close" }).click();

      await page.goto("/log");
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.locator("button.frow").filter({ hasText: "Morning oats" }).click();
      await page.locator("button.frow").filter({ hasText: "Morning broth" }).click();
      await page.getByRole("button", { name: "Save as group" }).click();
      const group = page.getByRole("dialog", { name: "Save as group" });
      await expectReplace(page, group.getByRole("textbox", { name: "Group name" }), "Morning");
      await fieldsAtLeast16(group);
      await group.getByRole("button", { name: "Close" }).click();

      await page.getByRole("button", { name: "Copy to…" }).click();
      const copy = page.getByRole("dialog", { name: "Copy to" });
      const date = copy.getByLabel("Pick another date");
      await expect(date).toBeFocused();
      await fieldsAtLeast16(copy);
      await copy.getByRole("button", { name: "Close" }).click();
      await page.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("link", { name: "Profile" }).click();
      await expectProfileQuiet(page);
      await fieldsAtLeast16(page.locator("main"));
    });
  });
}

/** Profile is a page, not a sheet, so opening it focuses nothing and does not raise the keyboard. */
async function expectProfileQuiet(page: Page) {
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  const where = await page.evaluate(() => {
    const active = document.activeElement;
    const main = document.querySelector("main");
    if (active && main?.contains(active)) return "page";
    if (active instanceof HTMLElement && active.classList.contains("kb-proxy")) return "keyboard";
    return "none";
  });
  expect(where).toBe("none");
}

test("profile does not focus a field when it loads", async ({ page }) => {
  const oid = `e2e-profile-quiet-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await sign(page, oid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/profile");
  await expectProfileQuiet(page);
});

test.describe("setup", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("setup focuses the birth year", async ({ page }) => {
    const oid = `e2e-setup-focus-${Date.now()}-${test.info().project.name}`;
    await sign(page, oid);
    await page.goto("/setup");
    const year = page.getByRole("textbox", { name: "Birth year" });
    await expectReplace(page, year, "1992");
    await fieldsAtLeast16(page.locator("main"));
  });
});

test("a desktop pointer also focuses and selects the primary field", async ({ page }) => {
  const oid = `e2e-focus-desk-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await sign(page, oid);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today");

  await page.locator("aside").getByRole("button", { name: /Add food/ }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  const search = food.getByRole("searchbox", { name: "Search foods" });
  await expect(search).toBeFocused();
  expect(await search.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeLessThan(16);
  await page.keyboard.type("ab");
  await expect(search).toHaveValue("ab");
  await food.getByRole("button", { name: "Close" }).click();

  await page.locator("aside").getByRole("button", { name: "Log weight" }).click();
  const weight = page.getByRole("dialog", { name: "Log weight" });
  await expectReplace(page, weight.getByRole("textbox", { name: "Weight in kilograms" }), "70", "caret");
});
