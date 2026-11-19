import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

/** A profiled user with a weigh-in and nothing logged, so Home shows the Add food prompt. */
async function setup(page: Page) {
  const oid = `e2e-home-sections-${Date.now()}-${test.info().project.name}`;
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
}

async function openHomeSections(page: Page) {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Settings switches Home's cards off, keeps the week, and remembers the choice", async ({ page }) => {
    await page.goto("/");
    await setup(page);

    const settings = await openHomeSections(page);
    const row = settings.locator("[data-home-row]");
    await expect(row).toContainText("5 of 5");
    await row.click();
    const sections = page.getByRole("dialog", { name: "Home sections" });
    const week = sections.getByRole("switch", { name: /^Week/ });
    await expect(week).toBeDisabled();
    await expect(week).toHaveAttribute("aria-checked", "true");
    const foods = sections.getByRole("switch", { name: /^Foods today/ });
    await foods.click();
    await expect(foods).toHaveAttribute("aria-checked", "false");
    await sections.getByRole("button", { name: "Back to settings" }).click();
    await expect(settings.locator("[data-home-row]")).toContainText("4 of 5");
    await expect(settings.locator("[data-home-row]")).toContainText("Week, Suggestions, Macros, Progress");
    await settings.getByRole("button", { name: "Close" }).click();

    await page.goto("/today");
    await expect(page.getByRole("region", { name: "Today's macros" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Progress", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Log your first food today/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();

    // Everything off: Home says so and links back to the page.
    await page.evaluate(() => localStorage.setItem("gymbro-home-hidden", JSON.stringify(["suggestions", "macros", "foods", "progress"])));
    await page.reload();
    await expect(page.getByText("Home shows only the week.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Today's macros" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Progress", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose sections" }).click();
    const again = page.getByRole("dialog", { name: "Home sections" });
    for (const name of ["Suggestions", "Macros", "Foods today", "Progress"]) {
      await expect(again.getByRole("switch", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-checked", "false");
    }
    await again.getByRole("switch", { name: /^Macros/ }).click();
    await again.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Home shows only the week.")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Today's macros" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("gymbro-home-hidden"))).toBe('["suggestions","foods","progress"]');
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test("Progress covers the weight card and This week, and the other columns share the width", async ({ page }) => {
    await page.goto("/");
    await setup(page);
    await page.evaluate(() => localStorage.setItem("gymbro-home-hidden", JSON.stringify(["progress"])));
    await page.goto("/today");

    await expect(page.getByRole("heading", { name: "Foods today" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This week" })).toHaveCount(0);
    await expect(page.locator(".card.wbig")).toHaveCount(0);
    const widths = await page.evaluate(() => [".c-a", ".c-c"].map((selector) => Math.round(document.querySelector(selector)!.getBoundingClientRect().width)));
    expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(2);

    const settings = await openHomeSections(page);
    await settings.locator("[data-home-row]").click();
    await expect(page.getByRole("dialog", { name: "Home sections" }).getByRole("switch", { name: /^Progress/ })).toContainText("The weight card and This week");
  });
});
