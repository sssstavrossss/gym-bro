import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-your-training-${Date.now()}-${test.info().project.name}`;
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
  }, oid);
  return oid;
}

/** Until a sheet has slid in, WebKit can drop a tap on it. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

test("Your training: set in Settings, kept on the account, and a new plan starts from it", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settled(settings);
  const row = settings.locator("[data-training-row]");
  await expect(row.locator("[data-training-line]")).toHaveText("Full gym · 60 min · Some experience");
  await row.click();

  // It opens over Settings.
  const sheet = page.getByRole("dialog", { name: "Your training" });
  await settled(sheet);
  await sheet.getByRole("button", { name: "5 minutes less" }).click();
  await sheet.getByRole("button", { name: "5 minutes less" }).click();
  await sheet.getByRole("button", { name: "5 minutes less" }).click();
  await expect(sheet.locator("[data-training-minutes]")).toHaveText("45 min");
  await sheet.getByRole("radio", { name: "New" }).click();
  await sheet.getByRole("button", { name: "Dumbbells" }).click();
  await sheet.getByRole("button", { name: "Full gym" }).click();
  // The last piece of equipment stays on: a plan needs some.
  await sheet.getByRole("button", { name: "Dumbbells" }).click();
  await expect(sheet.getByRole("button", { name: "Dumbbells" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Knees" }).click();
  await sheet.locator("[data-training-warm-up]").click();

  // Saved on the account, a moment after the last tap.
  await expect.poll(async () => {
    const body = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
    return body.profile.training;
  }).toEqual({ minutes: 45, experience: "new", equipment: ["dumbbells"], goEasy: ["knees"], warmUp: true, coolDown: false });

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(settings).toBeVisible();
  await expect(row.locator("[data-training-line]")).toHaveText("Dumbbells · 45 min · New to training");
  await settings.getByRole("button", { name: "Close" }).click();

  // A new plan starts from it.
  await page.goto("/train");
  await expect(page.locator("[data-plan-using]")).toContainText("Dumbbells · 45 min · New to training");
  await page.locator("[data-see-plan]").click();
  const planSheet = page.getByRole("dialog", { name: "New plan" });
  await settled(planSheet);
  await expect(planSheet.locator('[data-plan-new-workout="Full body A"]')).toContainText("With a warm-up");
  await planSheet.locator("[data-plan-save]").click();
  await expect(planSheet).toBeHidden();
  const saved = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan;
  expect([saved.minutes, saved.experience, saved.equipment, saved.goEasy, saved.warmUp]).toEqual([45, "new", ["dumbbells"], ["knees"], true]);

  // Changed later, Your training leaves the plan as it is until Edit plan saves it.
  await page.goto("/profile");
  await page.getByRole("button", { name: "Settings" }).click();
  await settled(settings);
  await settings.locator("[data-training-row]").click();
  await settled(sheet);
  await expect(sheet.locator("[data-training-plan-note]")).toBeVisible();
  await sheet.getByRole("button", { name: "5 minutes more" }).click();
  await expect(sheet.locator("[data-training-minutes]")).toHaveText("50 min");
  await expect.poll(async () => (await (await page.request.get("/api/profile", { headers: headers(oid) })).json()).profile.training.minutes).toBe(50);
  expect((await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan.minutes).toBe(45);

  await page.goto("/train");
  await page.locator("[data-plan-card]").getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit plan" });
  await settled(edit);
  await expect(edit.locator("[data-plan-using]")).toContainText("Dumbbells · 50 min · New to training");
  await expect(edit.locator("[data-plan-training-changed]")).toBeVisible();
  await edit.locator("[data-plan-save]").click();
  await expect(edit).toBeHidden();
  expect((await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan.minutes).toBe(50);
});
