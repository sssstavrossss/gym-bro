import { expect, test, type Page } from "@playwright/test";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function foodSheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

function card(page: Page) {
  return foodSheet(page).locator("[data-session]");
}

function addedRow(page: Page, name: string) {
  return card(page).locator("button.frow").filter({ hasText: name });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function start(page: Page, prefix: string) {
  const oid = `e2e-${prefix}-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  for (const [name, kcal] of [["Fictional added oats", 380], ["Fictional added pear", 60], ["Fictional added butter", 700]] as const) {
    const food = await page.request.post("/api/foods", {
      headers: headers(oid),
      data: { name, nutrientBasis: "per_100", basis: "g", kcalPer100: kcal, proteinPer100: 5, fatPer100: 5, carbsPer100: 5 },
    });
    expect(food.ok(), await food.text()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  // N opens Add food on any layout; the tab bar's Add is only on a phone.
  await page.keyboard.press("n");
  await foodSheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await foodSheet(page).getByRole("button", { name: /My foods/ }).click();
}

/** Opens one of the person's foods and adds its first amount (100 g). */
async function addFood(page: Page, name: string) {
  await foodSheet(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await foodSheet(page).getByRole("button", { name: /^Add · \d+ kcal/ }).click();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
}

const front = (page: Page) => page.locator(".toast.front:not(.toast-leave-active)");

test("the added card lists this visit's foods as Home's rows, newest first, two then scrolling", async ({ page }) => {
  await start(page, "added-rows");
  await addFood(page, "Fictional added oats");
  await addFood(page, "Fictional added pear");

  await expect(card(page)).toContainText("2 added · 440 kcal");
  const rows = card(page).locator("button.frow");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Fictional added pear");
  await expect(rows.nth(0)).toContainText("100 g");
  await expect(rows.nth(1)).toContainText("Fictional added oats");
  await expect(card(page).locator("[data-scroll-bar]")).toHaveCount(0);

  // A third: two rows show and the rest scroll inside the card, with Home's bar.
  await addFood(page, "Fictional added butter");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Fictional added butter");
  await expect(card(page).locator("[data-scroll-bar]")).toHaveCount(1);
  const list = (await card(page).locator("[data-added-rows]").boundingBox())!;
  const second = (await rows.nth(1).boundingBox())!;
  expect(list.height).toBeLessThan(second.y + second.height - list.y + 30);
});

test("tapping an added row edits it, and Save comes back to the search with the row updated", async ({ page }) => {
  await start(page, "added-edit");
  await addFood(page, "Fictional added oats");
  await addFood(page, "Fictional added pear");

  await addedRow(page, "Fictional added oats").click();
  await expect(foodSheet(page).getByRole("button", { name: /^Save · .*kcal/ })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "200 g" }).click();
  await foodSheet(page).getByRole("button", { name: /^Save · 760 kcal/ }).click();

  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await expect(foodSheet(page).getByRole("searchbox", { name: "Search foods" })).toBeVisible();
  await expect(addedRow(page, "Fictional added oats")).toContainText("200 g");
  await expect(card(page)).toContainText("2 added · 820 kcal");
  await expect(front(page)).toHaveText(/Updated Fictional added oats · 760 kcal/);

  // Back from an edit also returns to the search; Delete there takes the row out of the card.
  await addedRow(page, "Fictional added pear").click();
  await foodSheet(page).getByRole("button", { name: "Back" }).click();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await addedRow(page, "Fictional added pear").click();
  await foodSheet(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await expect(addedRow(page, "Fictional added pear")).toHaveCount(0);
  await expect(card(page)).toContainText("1 added · 760 kcal");
});

test("selecting on the card swaps its buttons in place, and Delete has Undo", async ({ page }) => {
  await start(page, "added-select");
  await addFood(page, "Fictional added oats");
  await addFood(page, "Fictional added pear");

  const top = async () => (await card(page).boundingBox())!.y;
  const before = await top();
  await card(page).getByRole("button", { name: "Select Fictional added pear" }).click();
  await expect(card(page)).toContainText("1 selected · 60 kcal");
  await expect(card(page)).toContainText("2 added · 440 kcal");
  await expect(card(page).getByRole("button", { name: "Save as group" })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Copy to…" })).toBeVisible();
  expect(Math.abs(await top() - before)).toBeLessThan(1);
  // The log's own select bar stays out of it.
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toHaveCount(0);

  // In select mode a tap toggles instead of editing.
  await addedRow(page, "Fictional added oats").click();
  await expect(card(page)).toContainText("2 selected · 440 kcal");
  await card(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card(page)).toBeHidden();
  await expect(front(page)).toHaveText(/Deleted 2 items/);
  await front(page).getByRole("button", { name: "Undo" }).click();
  await expect(card(page)).toContainText("2 added · 440 kcal");
  await expect(card(page).getByRole("button", { name: "Save as group" })).toBeVisible();
});

test("Copy to… from the card comes back to Add food", async ({ page }) => {
  await start(page, "added-copy");
  await addFood(page, "Fictional added oats");
  await addFood(page, "Fictional added pear");

  await card(page).getByRole("button", { name: "Select Fictional added oats" }).click();
  await card(page).getByRole("button", { name: "Copy to…" }).click();
  const copy = page.getByRole("dialog", { name: "Copy to" });
  await expect(copy.getByRole("heading", { name: "Copy 1 item to…" })).toBeVisible();
  await copy.getByRole("radio", { name: /^Tomorrow/ }).click();
  await copy.getByRole("button", { name: /^Copy to tomorrow/ }).click();

  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await expect(front(page)).toHaveText(/Copied 1 item · 380 kcal to tomorrow/);
  await expect(page).toHaveURL(/\/today$/);
  // The copy finished the selection; the card is as it was.
  await expect(card(page)).toContainText("2 added · 440 kcal");
  await expect(card(page).getByRole("button", { name: "Done" })).toBeVisible();
});

test.describe("with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false });

  test("hover shows Copy and Delete on an added row, and Esc steps back out of an edit and a selection", async ({ page }) => {
    await start(page, "added-hover");
    await addFood(page, "Fictional added oats");
    await addFood(page, "Fictional added pear");

    const pear = card(page).locator(".line").filter({ hasText: "Fictional added pear" });
    await pear.hover();
    await expect(pear.getByRole("button", { name: "Copy Fictional added pear to another day" })).toBeVisible();
    await pear.getByRole("button", { name: "Delete Fictional added pear" }).click();
    await expect(addedRow(page, "Fictional added pear")).toHaveCount(0);
    await expect(front(page)).toHaveText(/Deleted Fictional added pear/);

    await addedRow(page, "Fictional added oats").click();
    await expect(foodSheet(page).getByRole("button", { name: /^Save · .*kcal/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();

    await card(page).getByRole("button", { name: "Select Fictional added oats" }).click();
    await expect(card(page)).toContainText("1 selected");
    await page.keyboard.press("Escape");
    await expect(card(page)).toContainText("1 added");
    await expect(foodSheet(page)).toBeVisible();
  });
});
