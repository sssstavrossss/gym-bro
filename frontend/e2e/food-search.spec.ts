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

async function createFood(request: APIRequestContext, oid: string, body: Record<string, unknown>) {
  const response = await request.post("/api/foods", { headers: headers(oid), data: body });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function sheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

async function openAdd(page: Page, width: number) {
  await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
  if (width >= 1024) {
    await page.locator("aside").getByRole("button", { name: /Add food/ }).click();
  } else {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  }
  await expect(page.getByRole("dialog", { name: "Add", exact: true })).toBeHidden();
  await expect(sheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await expect(sheet(page).getByRole("searchbox", { name: "Search foods" })).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: "Search" })).toBeChecked();
}

async function expectClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 2).map((node) => node.html) })))).toEqual([]);
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(overflow).toBe(true);
}

test.describe("touch keypad", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the phone keypad sets the amount", async ({ page }) => {
    const oid = `e2e-f2-key-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await putWeighIn(page.request, oid, when.today, when.zone);
    await putProfile(page.request, oid, when.zone);
    await createFood(page.request, oid, {
      name: "Fictional keypad apple",
      kcalPer100: 50,
      proteinPer100: 0,
      fatPer100: 0,
      carbsPer100: 14,
      basis: "g",
    });
    await sign(page, oid);
    await page.goto("/today");
    await openAdd(page, 390);
    await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("apple");
    await sheet(page).getByRole("button", { name: /Fictional keypad apple/ }).click();
    const keypad = sheet(page).getByRole("group", { name: "Number keypad" });
    await expect(keypad).toBeVisible();
    await keypad.getByRole("button", { name: "2", exact: true }).click();
    await keypad.getByRole("button", { name: "5", exact: true }).click();
    await keypad.getByRole("button", { name: "0", exact: true }).click();
    await expect(sheet(page).getByRole("button", { name: /Add · 125 kcal/ })).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/f2-detail-keypad.png" });
  });
});

test("search, detail, multi-add, and stored-snapshot edit", async ({ page }) => {
  const oid = `e2e-f2-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await createFood(page.request, oid, {
    name: "Fictional chicken breast",
    kcalPer100: 200,
    proteinPer100: 30,
    fatPer100: 4,
    carbsPer100: 0,
    basis: "g",
    servingQuantity: 40,
    servingLabel: "porsjon",
    pieceQuantity: 60,
    pieceLabel: "filet",
  });
  await createFood(page.request, oid, {
    name: "Fictional oat brick",
    kcalPer100: 100,
    proteinPer100: 10,
    fatPer100: 2,
    carbsPer100: 15,
    basis: "g",
  });
  await createFood(page.request, oid, {
    name: "Fictional broth cube",
    kcalPer100: 12,
    proteinPer100: 1,
    fatPer100: 0,
    carbsPer100: 1,
    basis: "g",
  });

  await sign(page, oid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await openAdd(page, 390);
  await page.screenshot({ path: "/opt/cursor/artifacts/f2-search-empty.png" });
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("chicken");
  await sheet(page).getByRole("button", { name: /Fictional chicken breast/ }).click();
  await expect(sheet(page).getByRole("heading", { name: "Fictional chicken breast" })).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: /^g/ })).toBeChecked();
  await expect(sheet(page).getByRole("radio", { name: /porsjon/ })).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: /filet/ })).toBeVisible();
  await sheet(page).getByRole("button", { name: "150 g" }).click();
  await expect(sheet(page).getByRole("button", { name: /Add · 300 kcal/ })).toBeVisible();
  await expectClean(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/f2-detail-phone.png" });

  await sheet(page).getByLabel("Amount in g").fill("0");
  await sheet(page).getByRole("button", { name: /Add ·/ }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("Enter an amount above 0 and at most 10,000 g.");
  await sheet(page).getByLabel("Amount in g").fill("10001");
  await sheet(page).getByRole("button", { name: /Add ·/ }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("10,000 g");
  await sheet(page).getByRole("radio", { name: /porsjon/ }).click();
  await sheet(page).getByLabel(/Amount in serving/).fill("51");
  await sheet(page).getByRole("button", { name: /Add ·/ }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("50 servings");
  await sheet(page).getByRole("radio", { name: /^g/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("150");
  await sheet(page).getByRole("button", { name: /Add · 300 kcal/ }).click();

  await expect(page.getByText(/Added 150 g Fictional chicken breast · 300 kcal/)).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("searchbox", { name: "Search foods" })).toHaveValue("");
  await expect(sheet(page).getByText(/Today · 300 kcal/)).toBeVisible();
  await expect(sheet(page).getByText(/1 added · 300 kcal/)).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/f2-after-add.png" });

  await page.route("**/api/log-entries", (route) => {
    if (route.request().method() === "POST") return route.abort();
    return route.continue();
  });
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("oat");
  await sheet(page).getByRole("button", { name: /Fictional oat brick/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("100");
  await sheet(page).getByRole("button", { name: /Add ·/ }).click();
  await expect(page.getByText("server unreachable, try again", { exact: true })).toBeVisible();
  await expect(sheet(page).getByText("Nothing was lost — your entry is still here.")).toBeVisible();
  await expect(sheet(page).getByLabel("Amount in g")).toHaveValue("100");
  await sheet(page).getByRole("button", { name: "Back", exact: true }).click();
  await page.unroute("**/api/log-entries");

  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("broth");
  await sheet(page).getByRole("button", { name: /Fictional broth cube/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("100");
  await sheet(page).getByRole("button", { name: /Add ·/ }).click();
  await expect(sheet(page).getByText(/Today · 312 kcal/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: /Fictional oat brick/ })).toBeVisible();

  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const body = await listed.json();
  const names = body.entries.map((entry: { name: string }) => entry.name).sort();
  expect(names).toEqual(["Fictional broth cube", "Fictional chicken breast", "Fictional oat brick"]);
  expect(body.entries.find((entry: { name: string }) => entry.name === "Fictional chicken breast").grams).toBe(150);
  expect(body.entries.find((entry: { name: string }) => entry.name === "Fictional chicken breast").kcal).toBe(300);
  expect(body.entries.find((entry: { name: string }) => entry.name === "Fictional chicken breast").source).toBe("custom");

  await page.getByRole("button", { name: /Fictional chicken breast/ }).click();
  await expect(sheet(page).getByRole("heading", { name: "Fictional chicken breast" })).toBeVisible();
  const changed = await page.request.put(`/api/foods/${body.entries.find((entry: { name: string; foodId: string }) => entry.name === "Fictional chicken breast").foodId}`, {
    headers: headers(oid),
    data: {
      name: "Fictional chicken breast",
      kcalPer100: 50,
      proteinPer100: 30,
      fatPer100: 4,
      carbsPer100: 0,
      basis: "g",
      servingQuantity: 40,
      pieceQuantity: 70,
    },
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: /Fictional chicken breast/ }).click();
  await expect(sheet(page).getByText("Using the values it was logged with — this food has changed since.")).toBeVisible();
  await sheet(page).getByLabel("Amount in g").fill("300");
  await expect(sheet(page).getByRole("button", { name: /Save · 600 kcal/ })).toBeVisible();
  await sheet(page).getByRole("button", { name: /Save · 600 kcal/ }).click();
  await expect(sheet(page)).toBeHidden();
  const after = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const edited = (await after.json()).entries.find((entry: { name: string }) => entry.name === "Fictional chicken breast");
  expect(edited.kcal).toBe(600);
  expect(edited.grams).toBe(300);
  expect(edited.amount).toBe(300);
});

test("a double tap on add creates one entry", async ({ page }) => {
  const oid = `e2e-f2-tap-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await createFood(page.request, oid, {
    name: "Fictional tap peas",
    kcalPer100: 80,
    proteinPer100: 5,
    fatPer100: 1,
    carbsPer100: 10,
    basis: "g",
  });
  await sign(page, oid);
  await page.goto("/today");
  await openAdd(page, 390);
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("peas");
  await sheet(page).getByRole("button", { name: /Fictional tap peas/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("100");
  let posts = 0;
  await page.route("**/api/log-entries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.continue();
  });
  const add = sheet(page).getByRole("button", { name: /Add · 80 kcal/ });
  await add.dblclick();
  await expect(page.getByText(/Added 100 g Fictional tap peas/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Done", exact: true }).click();
  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  expect((await listed.json()).entries).toHaveLength(1);
  expect(posts).toBe(1);
});

async function saveShot(page: Page, name: string) {
  try {
    await page.screenshot({ path: `/tmp/${name}` });
  } catch {
    // A flaky screenshot write must not fail the layout checks.
  }
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
}

test("fractional per-100 text, full-height search, and the add toast stays off the session bar", async ({ page }) => {
  const oid = `e2e-f2-polish-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await createFood(page.request, oid, {
    name: "Fictional fraction fillet",
    kcalPer100: 165,
    proteinPer100: 31,
    fatPer100: 3.6,
    carbsPer100: 0,
    basis: "g",
  });
  await sign(page, oid);
  await page.goto("/today");
  await openAdd(page, 390);
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("fraction");
  const row = sheet(page).getByRole("button", { name: /Fictional fraction fillet/ });
  await expect(row).toContainText("F3.6");
  await expect(row).toContainText("P31");
  await expect(row).toContainText("C0");
  await expect(row).not.toContainText("F4");
  await expect(row).not.toContainText("F3.60");
  const panel = sheet(page).locator(".sheet");
  const box = await panel.boundingBox();
  expect(box!.y).toBeLessThan(40);
  expect(box!.height).toBeGreaterThan(844 * 0.75);
  expect(box!.y + box!.height).toBeGreaterThan(844 - 24);
  await saveShot(page, "f2-polish-search-full.png");

  await row.click();
  await expect(sheet(page).getByText("per 100 g · 165 kcal · P31 F3.6 C0")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  await sheet(page).getByRole("button", { name: /Add · 165 kcal/ }).click();
  const toast = page.locator(".toast");
  const session = sheet(page).locator(".session");
  await expect(toast).toBeVisible();
  await expect(session.getByText(/1 added/)).toBeVisible();
  await expect(session.getByText(/Today · 165 kcal/)).toBeVisible();
  const toastBox = await toast.boundingBox();
  const sessionBox = await session.boundingBox();
  const closeBox = await sheet(page).getByRole("button", { name: "Close", exact: true }).boundingBox();
  const searchBox = await sheet(page).getByRole("searchbox", { name: "Search foods" }).boundingBox();
  expect(overlaps(toastBox!, sessionBox!)).toBe(false);
  expect(overlaps(toastBox!, closeBox!)).toBe(false);
  expect(overlaps(toastBox!, searchBox!)).toBe(false);
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(closeBox!.y + 1);
  expect(toastBox!.y).toBeLessThan(sessionBox!.y);
  await saveShot(page, "f2-polish-toast-ax5.png");
});

test("desktop accepts a decimal comma and large text does not scroll sideways", async ({ page }) => {
  const oid = `e2e-f2-desk-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await createFood(page.request, oid, {
    name: "Fictional desk rice",
    kcalPer100: 200,
    proteinPer100: 4,
    fatPer100: 1,
    carbsPer100: 40,
    basis: "g",
  });
  await sign(page, oid);
  await page.goto("/today");
  await openAdd(page, 1440);
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("rice");
  await sheet(page).getByRole("button", { name: /Fictional desk rice/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("150,5");
  await expect(sheet(page).getByRole("button", { name: /Add · 301 kcal/ })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/f2-detail-desktop.png" });
  await sheet(page).getByRole("button", { name: "Close", exact: true }).click();

  await openAdd(page, 390);
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).fill("rice");
  await sheet(page).getByRole("button", { name: /Fictional desk rice/ }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  await expect(sheet(page).getByRole("heading", { name: "Fictional desk rice" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /Add ·/ })).toBeVisible();
  await expectNoSideScroll(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/f2-detail-large-text.png" });
});
