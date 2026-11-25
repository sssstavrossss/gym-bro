import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The food country follows the time zone: a phone that wakes up in Stockholm gets Swedish foods first, says so in
// a toast, and Change opens the picker. Picking Norway by hand puts Norwegian foods back first.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Stockholm" });

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function psql(sql: string) {
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, PGPASSWORD: "gymbro" },
  });
}

/** A Swedish and a Norwegian food that match the same word equally well. Words are lower-case ASCII, so search text is the name. */
function seedCatalogue(word: string, tag: string) {
  const row = (source: string, name: string, nameEn: string, kcal: number) =>
    `(gen_random_uuid(), '${source}', 'e2e-${tag}', '${name}', '${name.toLowerCase()}', '${nameEn}', '${nameEn.toLowerCase()}', 'g', 'per_100', ${kcal}, 5, 8, 20, now())`;
  psql(
    "insert into foods (id, source, source_id, name, search_name, name_en, search_name_en, basis, nutrient_basis, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100, updated_at) values "
      + [row("slv", `${word} sallad`, `${word} salad`, 180), row("mvt", `${word} kokt`, `${word} boiled`, 120)].join(", "),
  );
}

async function resultNames(page: Page, word: string): Promise<string[]> {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Search", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add food" });
  await sheet.getByRole("searchbox", { name: "Search foods" }).fill(word);
  await expect(sheet.locator(".rtext .t-body")).toHaveCount(2);
  const names = await sheet.locator(".rtext .t-body").allTextContents();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  return names;
}

test("the food country follows the time zone, says so, and can be picked by hand", async ({ page }) => {
  const tag = `${Date.now()}-${test.info().project.name}`.replace(/[^a-z0-9-]/gi, "");
  const oid = `e2e-country-${tag}`;
  const word = `zq${Date.now().toString(36)}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(new Date());
  expect((await page.request.put(`/api/weigh-ins/${today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: "Europe/Oslo" } })).ok()).toBeTruthy();
  // Saved in Oslo. This browser is in Stockholm, and the profile follows the device.
  const saved = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: "Europe/Oslo",
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  expect((await saved.json()).profile.foodCountry).toBe("NO");
  seedCatalogue(word, tag);
  try {
    await page.addInitScript((id) => {
      sessionStorage.setItem("gymbro-e2e", "1");
      sessionStorage.setItem("gymbro-e2e-oid", id);
    }, oid);
    await page.goto("/today");

    // The zone moves to Stockholm, and the country with it.
    const toast = page.getByText("In Sweden: Swedish foods first");
    await expect(toast).toBeVisible();
    await page.getByRole("button", { name: "Change" }).click();
    const picker = page.getByRole("dialog", { name: "Food country" });
    const follow = picker.getByRole("radio", { name: /Use the time zone/ });
    await expect(follow).toHaveAttribute("aria-checked", "true");
    await expect(follow).toContainText("Sweden · from Europe/Stockholm");
    await expect(follow).toBeInViewport();
    await expect(picker.locator('[data-country="SE"]')).toContainText("Livsmedelsverket");
    const results = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
    const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
    expect(serious.map((item) => item.id)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("country-picker.png") });
    await picker.getByRole("button", { name: "Close" }).click();

    // In Sweden the Swedish food comes first by its own name; the Norwegian one goes by its English name.
    expect(await resultNames(page, word)).toEqual([`${word} sallad`, `${word} boiled`]);

    // Picked by hand: Norway, and Norwegian foods first again.
    await page.getByRole("link", { name: /Profile/ }).click();
    await page.locator("[data-cog]").click();
    const row = page.locator("[data-country-row]");
    await expect(row).toContainText("Follows the time zone");
    await expect(row).toContainText("Sweden");
    await row.click();
    await picker.getByRole("searchbox", { name: "Search countries" }).fill("norw");
    await picker.locator('[data-country="NO"]').click();
    await expect(row).toContainText("Norway");
    await expect(row).toContainText("Set by hand");
    await page.screenshot({ path: test.info().outputPath("country-settings.png") });
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).click();
    await page.getByRole("link", { name: /Today/ }).click();
    expect(await resultNames(page, word)).toEqual([`${word} kokt`, `${word} salad`]);

    const state = await page.request.get("/api/profile", { headers: headers(oid) });
    expect((await state.json()).profile).toMatchObject({ timeZone: "Europe/Stockholm", foodCountry: "NO", foodCountryFollowsZone: false });
  } finally {
    psql(`update foods set retired_at = now() where source_id = 'e2e-${tag}' and user_id is null`);
  }
});
