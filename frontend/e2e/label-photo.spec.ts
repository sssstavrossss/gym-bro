import { expect, test, type Page } from "@playwright/test";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function sheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|New food)$/ });
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
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  await page.keyboard.press("n");
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await sheet(page).getByRole("button", { name: /My foods/ }).click();
  await sheet(page).getByRole("button", { name: /^New food/ }).click();
  await expect(sheet(page).getByRole("heading", { name: "New food" })).toBeVisible();
  await sheet(page).getByRole("textbox", { name: "Name", exact: true }).fill("Fictional label snack");
  return oid;
}

/** A real picture, so the app shrinks it the way it shrinks a phone photo. The test server reads every photo as the same label. */
async function labelPhoto(page: Page) {
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1200, 900);
    context.fillStyle = "#000000";
    context.font = "48px sans-serif";
    context.fillText("Næringsinnhold per 100 g", 60, 120);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  return { name: "label.png", mimeType: "image/png", buffer: png };
}

test("a label photo fills New food for checking, with saturated fat, sugars, fibre and salt", async ({ page }) => {
  await start(page, "label-fill");
  const top = sheet(page).getByRole("button", { name: "Fill from a label photo" });
  // One in the top bar, one at the top of the form.
  await expect(top).toHaveCount(2);
  const bar = (await top.first().boundingBox())!;
  expect(bar.width).toBeGreaterThanOrEqual(44);
  expect(bar.height).toBeGreaterThanOrEqual(44);
  await expect(sheet(page).getByRole("button", { name: "Scan the barcode" })).toBeVisible();

  // Typed by hand, the extra four stay folded away.
  await expect(sheet(page).locator("[data-extras]")).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "More nutrients" })).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith("/api/foods/label"));
  await sheet(page).locator("[data-label-input]").setInputFiles(await labelPhoto(page));
  const body = (await sent).postDataJSON();
  expect(body.photo.mediaType).toBe("image/jpeg");

  await expect(sheet(page).getByText("Filled from the label. Check the numbers before you save.")).toBeVisible();
  await expect(sheet(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Fictional label crispbread");
  await expect(sheet(page).getByRole("textbox", { name: /Brand/ })).toHaveValue("Northbar");
  await expect(sheet(page).getByRole("radio", { name: "Per 100 g" })).toBeChecked();
  await expect(sheet(page).getByRole("textbox", { name: /Serving name/ })).toHaveValue("slice");
  await expect(sheet(page).getByRole("textbox", { name: /Serving size/ })).toHaveValue("13");
  await expect(sheet(page).getByRole("textbox", { name: /Calories/ })).toHaveValue("370");
  await expect(sheet(page).getByRole("textbox", { name: /^Fat/ })).toHaveValue("6.5");
  await expect(sheet(page).getByRole("textbox", { name: /Saturated fat/ })).toHaveValue("1.1");
  await expect(sheet(page).getByRole("textbox", { name: /Fibre/ })).toHaveValue("17");
  await expect(sheet(page).getByRole("textbox", { name: /Salt/ })).toHaveValue("1");
  await expect(sheet(page).getByRole("button", { name: "Try another photo" })).toBeVisible();

  // Nothing is saved until Save food; then the extras are kept with the food.
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/foods") && response.request().method() === "POST");
  await sheet(page).getByRole("button", { name: "Save food" }).click();
  const food = await (await saved).json();
  expect(food.name).toBe("Fictional label crispbread");
  expect(food.saturatedFatPer100).toBe(1.1);
  expect(food.fiberPer100).toBe(17);
  expect(food.saltPer100).toBe(1);
});

test("a label the server can't read says so and keeps what was typed", async ({ page }) => {
  await start(page, "label-miss");
  await page.route("**/api/foods/label", (route) => route.fulfill({
    status: 422,
    contentType: "application/json",
    body: JSON.stringify({ error: "Couldn't find a nutrition table in that photo. Try one closer to the table, in good light." }),
  }));
  await sheet(page).locator("[data-label-input]").setInputFiles(await labelPhoto(page));
  await expect(sheet(page).getByRole("alert")).toContainText("Couldn't find a nutrition table in that photo.");
  await expect(sheet(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Fictional label snack");
  await expect(sheet(page).getByRole("button", { name: "Try another photo" })).toBeVisible();
});

test("the top bar's barcode button puts a scanned number in the Barcode field without a lookup", async ({ page }) => {
  await start(page, "label-scan");
  let lookups = 0;
  await page.route("**/api/foods/barcode/**", (route) => {
    lookups++;
    return route.continue();
  });
  await sheet(page).getByRole("button", { name: "Scan the barcode" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Scan the barcode" })).toBeVisible();
  // While scanning, the top bar has only Back and Close.
  await expect(sheet(page).getByRole("button", { name: "Scan the barcode" })).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Type the number" }).click();
  await sheet(page).getByRole("textbox", { name: "Barcode number" }).fill("2000000000015");
  await sheet(page).getByRole("button", { name: "Use", exact: true }).click();

  await expect(sheet(page).getByRole("heading", { name: "New food" })).toBeVisible();
  await expect(sheet(page).getByRole("textbox", { name: /Barcode/ })).toHaveValue("2000000000015");
  // What was typed is still there.
  await expect(sheet(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Fictional label snack");
  expect(lookups).toBe(0);

  // Back from the scanner returns to the form, not out of New food.
  await sheet(page).getByRole("button", { name: "Scan the barcode" }).click();
  await sheet(page).getByRole("button", { name: "Back" }).click();
  await expect(sheet(page).getByRole("heading", { name: "New food" })).toBeVisible();
});
