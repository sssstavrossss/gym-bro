import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plan-setup-${Date.now()}-${test.info().project.name}`;
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

test("A plan: answer the questions, see the preview, create it, edit it and end it", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");

  // Goal and days on the card: three days make a full-body plan, a fourth makes it Upper / Lower.
  const make = page.locator("[data-plan-card]");
  const stats = make.locator("[data-plan-stats]");
  await expect(stats).toContainText("Full body");
  await expect(stats).toContainText("3 workouts");
  await make.getByRole("button", { name: "Thursday" }).click();
  await expect(make.getByRole("button", { name: "Thursday" })).toHaveAttribute("aria-pressed", "true");
  await expect(stats).toContainText("Upper / Lower");
  await expect(stats).toContainText("4 workouts");

  // The rest is Your training, behind the line under them.
  await make.locator("[data-plan-using]").click();
  const training = page.getByRole("dialog", { name: "Your training" });
  await settled(training);
  await training.getByRole("button", { name: "5 minutes less" }).click();
  await expect(training.locator("[data-training-minutes]")).toHaveText("55 min");
  await training.getByRole("button", { name: "Knees" }).click();
  await training.getByRole("button", { name: "Dumbbells" }).click();
  await training.getByRole("button", { name: "Full gym" }).click();
  await training.getByRole("button", { name: "Close" }).click();
  await expect(make.locator("[data-plan-using]")).toContainText("Dumbbells · 55 min · Some experience");

  // See my plan: the plan before it starts, with its week and each workout's days.
  await make.getByRole("button", { name: "See my plan" }).click();
  const sheet = page.getByRole("dialog", { name: "New plan" });
  await settled(sheet);
  const preview = sheet.locator("[data-plan-preview]");
  await expect(preview).toContainText("Upper / Lower");
  await expect(sheet.locator("[data-plan-new-workout]")).toHaveCount(4);
  await expect(sheet.locator('[data-plan-new-workout="Upper A"]')).toContainText("Mon");
  await expect(sheet.locator('[data-plan-week] [data-state="planned"]')).toHaveCount(4);
  // Going easy on an area eases in.
  await expect(sheet.locator("[data-plan-block-note]")).toContainText("The first 2 weeks ease in.");
  await expect(sheet.getByText("check with them before you start")).toBeVisible();

  await sheet.locator("[data-plan-save]").click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Plan made")).toBeVisible();
  const card = page.locator("[data-plan-card]");
  await expect(card).toContainText("Muscle · Upper / Lower · 4 days · 55 min");
  await expect(card.locator("[data-plan-workout]")).toHaveCount(4);
  await expect(card.locator('[data-plan-workout="Upper A"]')).toContainText("exercises");

  const saved = await (await page.request.get("/api/plan", { headers: headers(oid) })).json();
  expect(saved.plan.equipment).toEqual(["dumbbells"]);
  expect(saved.plan.goEasy).toEqual(["knees"]);
  expect(saved.plan.weekdays).toEqual([0, 2, 3, 4]);

  // Edit: the answers come back, and a new split remakes the workouts.
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit plan" });
  await expect(edit.locator("[data-plan-minutes]")).toHaveText("55 min");
  await expect(edit.getByRole("button", { name: "Knees" })).toHaveAttribute("aria-pressed", "true");
  await edit.getByRole("button", { name: "Change split" }).click();
  await edit.getByRole("radio", { name: "Full body" }).click();
  await expect(edit.locator("[data-plan-preview]")).toContainText("Full body, 2 workouts in turn");
  await edit.locator("[data-plan-save]").click();
  await expect(page.getByText("Plan saved")).toBeVisible();
  await expect(card).toContainText("Muscle · Full body · 4 days · 55 min");
  await expect(card.locator("[data-plan-workout]")).toHaveCount(2);

  // Ending asks first.
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await edit.getByRole("button", { name: "End plan" }).click();
  const confirm = edit.getByRole("alertdialog", { name: "End your plan?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "End plan" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText("Plan ended")).toBeVisible();
  await expect(page.locator("[data-see-plan]")).toBeVisible();
  expect((await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan).toBeNull();
});
