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

async function logFood(request: APIRequestContext, oid: string, date: string, zone: string, name: string, time: string, kcal: number) {
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

function foodSheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

function row(page: Page, name: string) {
  return page.locator("main button.frow").filter({ hasText: name });
}

async function deleteEntry(page: Page, name: string) {
  await row(page, name).click();
  await expect(page.getByRole("heading", { name: "Edit food" })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(foodSheet(page)).toBeHidden();
}

async function start(page: Page, prefix: string) {
  const oid = `e2e-${prefix}-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await logFood(page.request, oid, when.today, when.zone, "Fictional oats", "08:15", 200);
  await logFood(page.request, oid, when.today, when.zone, "Fictional broth", "12:30", 50);
  await logFood(page.request, oid, when.today, when.zone, "Fictional pear", "15:00", 90);
  await page.setViewportSize({ width: 390, height: 844 });
  await sign(page, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  await expect(row(page, "Fictional pear")).toBeVisible();
}

test("back-to-back deletes become one toast, and its Undo brings both back", async ({ page }) => {
  await start(page, "toast-merge");

  await deleteEntry(page, "Fictional oats");
  await deleteEntry(page, "Fictional broth");
  const front = page.locator(".toast.front:not(.toast-leave-active)");
  await expect(front).toHaveText(/Deleted 2 items/);
  await expect(page.locator(".toast")).toHaveCount(1);

  // Above the tab bar, inside the screen.
  const toastBox = (await front.boundingBox())!;
  const tabBox = (await page.locator("nav.tabbar, .tabbar").first().boundingBox())!;
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(tabBox.y + 1);
  expect(toastBox.x).toBeGreaterThanOrEqual(0);
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(390);

  // It stands out from the cards behind it: a lighter surface of its own and a drop shadow.
  const look = await front.evaluate((toast) => {
    const card = document.querySelector(".card");
    return { toast: getComputedStyle(toast).backgroundColor, card: card ? getComputedStyle(card).backgroundColor : "", shadow: getComputedStyle(toast).boxShadow };
  });
  expect(look.card).not.toBe("");
  expect(look.toast).not.toBe(look.card);
  expect(look.shadow).not.toBe("none");

  await front.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Fictional oats")).toBeVisible();
  await expect(row(page, "Fictional broth")).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("different toasts wait behind the front one, and a swipe throws the front one off", async ({ page }) => {
  await start(page, "toast-stack");

  await deleteEntry(page, "Fictional oats");
  await row(page, "Fictional pear").click();
  await expect(page.getByRole("heading", { name: "Edit food" })).toBeVisible();
  await foodSheet(page).getByRole("textbox", { name: "Calories", exact: true }).fill("95");
  await foodSheet(page).getByRole("button", { name: /Save · .*kcal/ }).click();

  const front = page.locator(".toast.front:not(.toast-leave-active)");
  const back = page.locator(".toast.back");
  await expect(front).toHaveText(/Deleted Fictional oats/);
  await expect(back).toHaveCount(1);
  await expect(back).toHaveAttribute("aria-hidden", "true");
  await expect(back).not.toHaveClass(/toast-(enter|move)/);
  await expect(front).not.toHaveClass(/toast-(enter|move)/);
  // Only the edge of the one behind shows: it sits under the front one and pokes out above it.
  const frontBox = (await front.boundingBox())!;
  const backBox = (await back.boundingBox())!;
  expect(backBox.y).toBeLessThan(frontBox.y);
  expect(backBox.y + backBox.height).toBeLessThan(frontBox.y + frontBox.height);

  // Swipe sideways: the front one goes and the edit's toast comes forward.
  const x = frontBox.x + frontBox.width / 3;
  const y = frontBox.y + frontBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 4 });
  await page.mouse.move(x + 140, y + 10, { steps: 4 });
  await page.mouse.up();
  // A mouse resting on a toast holds it, so move off before waiting for it to go.
  await page.mouse.move(10, 120);
  await expect(front).toHaveText(/Updated Fictional pear · 95 kcal/);
  await expect(page.locator(".toast")).toHaveCount(1);
  await expect(row(page, "Fictional oats")).toHaveCount(0);

  // It has its own 4 seconds, then the stack is empty.
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 8_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(overflow).toBe(true);
});

async function editKcal(page: Page, name: string, kcal: string) {
  await row(page, name).click();
  await expect(page.getByRole("heading", { name: "Edit food" })).toBeVisible();
  await foodSheet(page).getByRole("textbox", { name: "Calories", exact: true }).fill(kcal);
  await foodSheet(page).getByRole("button", { name: /Save · .*kcal/ }).click();
  await expect(foodSheet(page)).toBeHidden();
}

test("a new Undo doesn't wait out the plain toasts ahead of it", async ({ page }) => {
  await start(page, "toast-cut");

  await editKcal(page, "Fictional pear", "95");
  await editKcal(page, "Fictional oats", "210");
  await expect(page.locator(".toast.back")).toHaveCount(1);
  await page.mouse.move(10, 120);

  // Two plain toasts are ahead of this delete. Each would take 4 s; cut short, its Undo is in front within about 2 s.
  const started = Date.now();
  await deleteEntry(page, "Fictional broth");
  const undo = page.locator(".toast.front").filter({ hasText: "Deleted Fictional broth" }).getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible({ timeout: 4_000 });
  expect(Date.now() - started).toBeLessThan(4_000);
  await undo.click();
  await expect(row(page, "Fictional broth")).toBeVisible();
});
