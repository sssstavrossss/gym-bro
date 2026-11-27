import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page): Promise<string> {
  const oid = `e2e-plan-explore-${Date.now()}-${test.info().project.name}`;
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

test("Explore → Plans: the kinds of plan, a week of one, and starting it", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/train");

  await page.locator("[data-explore-plans]").click();
  const sheet = page.getByRole("dialog", { name: "Plans" });
  await settled(sheet);
  await expect(sheet.locator("[data-plan-kind]")).toHaveCount(6);
  await expect(sheet.locator('[data-plan-kind="hyrox"]')).toContainText("Strength, the race's stations and runs");

  // Upper / Lower is made for 4 days; the card's 3 don't fit, so its week is Mon, Tue, Thu, Fri.
  await sheet.locator('[data-plan-kind="upper_lower"]').click();
  const kind = page.getByRole("dialog", { name: "Upper / Lower" });
  await expect(kind.locator("[data-plan-new-workout]")).toHaveText([/^Upper A/, /^Lower A/, /^Upper B/, /^Lower B/]);
  await expect(kind.locator('[data-plan-week] [data-state="planned"]')).toHaveCount(4);
  await expect(kind.locator('[data-plan-new-workout="Upper A"]')).toContainText("Mon");

  // Back to the list, and on to Hyrox.
  await kind.getByRole("button", { name: "Back to Plans" }).click();
  await sheet.locator('[data-plan-kind="hyrox"]').click();
  const hyrox = page.getByRole("dialog", { name: "Hyrox" });
  await expect(hyrox.locator('[data-plan-new-workout="Stations A"]')).toBeVisible();
  await hyrox.getByRole("button", { name: "Back to Plans" }).click();
  await sheet.locator('[data-plan-kind="upper_lower"]').click();
  await expect(kind.locator("[data-plan-new-workout]")).toHaveCount(4);

  // Use this plan opens New plan on it, and the card takes its days.
  await kind.locator("[data-plan-kind-use]").click();
  const plan = page.getByRole("dialog", { name: "New plan" });
  await settled(plan);
  await expect(plan.locator("[data-plan-preview]")).toContainText("Upper / Lower");
  await expect(plan.locator("[data-plan-new-workout]")).toHaveCount(4);
  await plan.locator("[data-plan-save]").click();
  await expect(plan).toBeHidden();
  await expect(page.getByText("Plan made")).toBeVisible();
  const saved = (await (await page.request.get("/api/plan", { headers: headers(oid) })).json()).plan;
  expect([saved.goal, saved.split, saved.weekdays]).toEqual(["muscle", "upper_lower", [0, 1, 3, 4]]);
});
