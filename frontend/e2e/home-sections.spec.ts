import { expect, test, type Browser, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

/** A profiled user with a weigh-in and nothing logged, so Home shows the Add food prompt. */
async function setup(page: Page): Promise<string> {
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
  await signIn(page, oid);
  return oid;
}

async function signIn(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

async function putSettings(page: Page, oid: string, data: Record<string, string[]>) {
  expect((await page.request.put("/api/profile/settings", { headers: headers(oid), data })).ok()).toBeTruthy();
}

/** Another phone signed in to the same account, with nothing stored on it. */
async function otherDevice(browser: Browser, oid: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signIn(page, oid);
  return { context, page };
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

  test("Settings switches Home's cards off, keeps the week, and the account remembers it", async ({ page, browser }) => {
    await page.goto("/");
    const oid = await setup(page);

    const settings = await openHomeSections(page);
    const row = settings.locator("[data-home-row]");
    await expect(row).toContainText("6 of 6");
    await row.click();
    const sections = page.getByRole("dialog", { name: "Home sections" });
    const week = sections.getByRole("switch", { name: /^Week/ });
    await expect(week).toBeDisabled();
    await expect(week).toHaveAttribute("aria-checked", "true");
    const foods = sections.getByRole("switch", { name: /^Foods today/ });
    await foods.click();
    await expect(foods).toHaveAttribute("aria-checked", "false");
    await sections.getByRole("button", { name: "Back to settings" }).click();
    await expect(settings.locator("[data-home-row]")).toContainText("5 of 6");
    await expect(settings.locator("[data-home-row]")).toContainText("Week, Suggestions, Training, Macros, Progress");
    await settings.getByRole("button", { name: "Close" }).click();

    await page.goto("/today");
    await expect(page.getByRole("region", { name: "Today's macros" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Progress", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Log your first food today/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();

    // Another device gets the same Home.
    const other = await otherDevice(browser, oid);
    await other.page.goto("/today");
    await expect(other.page.getByRole("region", { name: "Today's macros" })).toBeVisible();
    await expect(other.page.getByRole("region", { name: "Progress", exact: true })).toBeVisible();
    await expect(other.page.getByRole("button", { name: /Log your first food today/ })).toHaveCount(0);
    await other.context.close();

    // Everything off (saved from elsewhere): Home says so and links back to the page.
    await putSettings(page, oid, { homeHidden: ["suggestions", "training", "macros", "foods", "progress"] });
    await page.reload();
    await expect(page.getByText("Home shows only the week.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Today's macros" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Progress", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose sections" }).click();
    const again = page.getByRole("dialog", { name: "Home sections" });
    for (const name of ["Suggestions", "Training", "Macros", "Foods today", "Progress"]) {
      await expect(again.getByRole("switch", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-checked", "false");
    }
    await again.getByRole("switch", { name: /^Macros/ }).click();
    await again.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Home shows only the week.")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Today's macros" })).toBeVisible();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
      return state.profile.homeHidden;
    }).toEqual(["suggestions", "training", "foods", "progress"]);
    expect(await page.evaluate(() => localStorage.getItem("gymbro-home-hidden"))).toBe('["suggestions","training","foods","progress"]');
  });

  test("a device's earlier choice moves to the account, and card pages follow it", async ({ page, browser }) => {
    await page.goto("/");
    const oid = await setup(page);
    // Chosen on this phone before the account kept it.
    await page.evaluate(() => {
      localStorage.setItem("gymbro-home-hidden", JSON.stringify(["foods"]));
      localStorage.setItem("gymbro-home-progress-hidden", JSON.stringify(["sodium"]));
    });
    await page.goto("/today");
    await expect(page.getByRole("button", { name: /Log your first food today/ })).toHaveCount(0);
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
      return [state.profile.homeHidden, state.profile.progressHidden, state.profile.macrosHidden];
    }).toEqual([["foods"], ["sodium"], null]);

    // The cog's pages on this phone show up on the other one.
    await page.getByRole("region", { name: "Today's macros" }).getByRole("button", { name: "Choose macros card pages" }).click();
    await page.getByRole("dialog", { name: "Macros card pages" }).getByRole("switch", { name: /^Vitamins/ }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/profile", { headers: headers(oid) })).json();
      return state.profile.macrosHidden;
    }).toEqual(["vitamins"]);

    const other = await otherDevice(browser, oid);
    await other.page.goto("/today");
    await expect(other.page.getByRole("button", { name: /Log your first food today/ })).toHaveCount(0);
    await other.page.getByRole("region", { name: "Today's macros" }).getByRole("button", { name: "Choose macros card pages" }).click();
    const sheet = other.page.getByRole("dialog", { name: "Macros card pages" });
    await expect(sheet.getByRole("switch", { name: /^Vitamins/ })).toHaveAttribute("aria-checked", "false");
    await expect(sheet.getByRole("switch", { name: /^Minerals/ })).toHaveAttribute("aria-checked", "true");
    await other.context.close();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test("Progress covers the weight card and This week, and the other columns share the width", async ({ page }) => {
    await page.goto("/");
    const oid = await setup(page);
    await putSettings(page, oid, { homeHidden: ["progress"] });
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
