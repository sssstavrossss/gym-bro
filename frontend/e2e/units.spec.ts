import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true, timezoneId: "UTC" });

test("units: pounds and feet in Settings, typed values kept exactly", async ({ page }) => {
  const oid = `e2e-units-${Date.now()}-${test.info().project.name}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  expect((await page.request.put(`/api/weigh-ins/${today}`, { headers, data: { kg: 83.6, timeZone: "UTC" } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: "UTC",
    },
  })).ok()).toBeTruthy();

  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/profile");
  await expect(page.getByRole("textbox", { name: "Goal weight in kilograms" })).toHaveValue("80");

  // Settings: two switches, saved on the account straight away.
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator("[data-units]")).toBeVisible();
  await settings.getByRole("radiogroup", { name: "Weight unit" }).getByRole("radio", { name: "lb" }).click();
  await settings.getByRole("radiogroup", { name: "Height unit" }).getByRole("radio", { name: "feet and inches" }).click();
  await expect(settings.getByRole("radio", { name: "feet and inches" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await (await page.request.get("/api/profile", { headers })).json()).profile.heightUnit).toBe("ftin");
  const saved = (await (await page.request.get("/api/profile", { headers })).json()).profile;
  expect(saved.weightUnit).toBe("lb");
  expect(saved.goalWeightKg).toBe(80);
  expect(saved.heightCm).toBe(180);
  // Units are a setting, not a target change.
  const history = await (await page.request.get("/api/profile/history", { headers })).json();
  expect(history.rows).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // The profile now shows pounds and feet.
  const goal = page.getByRole("textbox", { name: "Goal weight in pounds" });
  await expect(goal).toHaveValue("176.4");
  await expect(page.getByRole("group", { name: "Rate" })).toContainText("lb/wk");
  await expect(page.getByRole("button", { name: "1.1" })).toHaveClass(/on/);
  await expect(page.getByRole("textbox", { name: "Height, feet" })).toHaveValue("5");
  await expect(page.getByRole("textbox", { name: "Height, inches" })).toHaveValue("10.9");
  await expect(page.locator("[data-goal-line]")).toContainText("lb to go");
  await expect(page.getByRole("button", { name: /Weight.*184\.3 lb/ })).toBeVisible();
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/units-profile.png" });
  }

  // A goal typed in pounds keeps two kilogram decimals.
  await goal.fill("165");
  await goal.blur();
  await expect.poll(async () => (await (await page.request.get("/api/profile", { headers })).json()).profile.goalWeightKg).toBe(74.84);
  // A height typed in feet and inches.
  const inches = page.getByRole("textbox", { name: "Height, inches" });
  await inches.fill("11");
  await inches.blur();
  await expect.poll(async () => (await (await page.request.get("/api/profile", { headers })).json()).profile.heightCm).toBe(180.3);

  // A weigh-in typed in pounds comes back as typed.
  await page.getByRole("button", { name: /Weight.*184\.3 lb/ }).click();
  const sheet = page.getByRole("dialog", { name: "Log weight" });
  await expect(sheet.getByText("lb", { exact: true }).first()).toBeVisible();
  await sheet.getByRole("textbox", { name: "Weight in pounds" }).fill("180");
  await sheet.getByRole("button", { name: /^Save 180(\.0)? lb$/ }).click();
  await expect(page.getByText(/Replaced the weigh-in with 180\.0 lb/)).toBeVisible();
  const rows = await (await page.request.get("/api/weigh-ins", { headers })).json();
  expect(rows.weighIns[0].kg).toBe(81.65);

  // After a reload the units and values stay.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Goal weight in pounds" })).toHaveValue("165");
  await expect(page.getByRole("textbox", { name: "Height, inches" })).toHaveValue("11");

  // Home follows.
  await page.goto("/today");
  await expect(page.getByRole("group", { name: "Weight" })).toContainText("180.0 lb");

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(fits).toBe(true);
});

test("units: Setup in pounds and feet", async ({ page }) => {
  const oid = `e2e-units-setup-${Date.now()}-${test.info().project.name}`;
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User" };
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up" })).toBeVisible();

  await page.getByRole("radio", { name: "Male", exact: true }).click();
  await page.getByRole("textbox", { name: "Birth year" }).fill(String(new Date().getFullYear() - 36));
  await page.getByRole("textbox", { name: "Height in centimetres" }).fill("180");
  // Switching carries what was typed.
  await page.getByRole("radiogroup", { name: "Height unit" }).getByRole("radio", { name: "feet and inches" }).click();
  await expect(page.getByRole("textbox", { name: "Height, feet" })).toHaveValue("5");
  await expect(page.getByRole("textbox", { name: "Height, inches" })).toHaveValue("10.9");
  await page.getByRole("radiogroup", { name: "Weight unit" }).getByRole("radio", { name: "lb" }).click();
  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByRole("button", { name: "Moderate" }).click();
  await page.getByRole("radio", { name: "Lose" }).click();
  await page.getByRole("button", { name: "1.1" }).click();
  await page.getByRole("textbox", { name: "Goal weight in pounds" }).fill("165");
  await page.getByRole("textbox", { name: "Starting weight in pounds" }).fill("184,3");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/units-setup.png", fullPage: true });
  }
  await page.getByRole("button", { name: "Save and see targets" }).click();
  await expect(page.getByRole("heading", { name: "Your targets" })).toBeVisible();

  const state = await (await page.request.get("/api/profile", { headers })).json();
  expect(state.profile.weightUnit).toBe("lb");
  expect(state.profile.heightUnit).toBe("ftin");
  expect(state.profile.heightCm).toBe(180);
  expect(state.profile.goalWeightKg).toBe(74.84);
  expect(state.profile.rateKgPerWeek).toBe(0.5);
  const rows = await (await page.request.get("/api/weigh-ins", { headers })).json();
  expect(rows.weighIns[0].kg).toBe(83.6);
  await expect(page.getByRole("textbox", { name: "Goal weight in pounds" })).toHaveValue("165");
});
