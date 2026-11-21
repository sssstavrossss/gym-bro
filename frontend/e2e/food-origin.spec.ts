import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// A food from another country's table (Livsmedelsverket, Sweden) shows by its English name with a country tag,
// sorts after the home table's matches, and is logged under the name it was shown with.

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

async function setUp(request: APIRequestContext, oid: string, today: string, zone: string) {
  const weighIn = await request.put(`/api/weigh-ins/${today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: zone } });
  expect(weighIn.ok(), await weighIn.text()).toBeTruthy();
  const profile = await request.put("/api/profile", {
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
  expect(profile.ok(), await profile.text()).toBeTruthy();
}

function psql(sql: string) {
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, PGPASSWORD: "gymbro" },
  });
}

/** Catalogue foods only come from imports, so the test writes two straight into the table. Words are lower-case ASCII, so search text is the name. */
function seedCatalogue(word: string, tag: string) {
  const row = (source: string, id: string, name: string, nameEn: string, kcal: number) =>
    `(gen_random_uuid(), '${source}', '${id}', '${name}', '${name.toLowerCase()}', '${nameEn}', '${nameEn.toLowerCase()}', 'g', 'per_100', ${kcal}, 5, 8, 20, now())`;
  psql(
    "insert into foods (id, source, source_id, name, search_name, name_en, search_name_en, basis, nutrient_basis, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100, updated_at) values "
      + [
        row("slv", `e2e-${tag}`, `${word} sallad med fetaost`, `${word} salad with feta`, 180),
        row("mvt", `e2e-${tag}`, `${word} kokt`, `${word} boiled`, 120),
      ].join(", "),
  );
}

function retireCatalogue(tag: string) {
  psql(`update foods set retired_at = now() where source_id = 'e2e-${tag}' and user_id is null`);
}

function sheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

test("another country's food: English name, country tag, after home matches, logged as shown", async ({ page }) => {
  const tag = `${Date.now()}-${test.info().project.name}`.replace(/[^a-z0-9-]/gi, "");
  const oid = `e2e-origin-${tag}`;
  // A made-up word, so only the two seeded foods match.
  const word = `zq${Date.now().toString(36)}`;
  const when = await clock(page);
  await setUp(page.request, oid, when.today, when.zone);
  seedCatalogue(word, tag);
  try {
    await sign(page, oid);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
    const search = sheet(page).getByRole("searchbox", { name: "Search foods" });
    await search.fill(word);

    const home = sheet(page).getByRole("button", { name: new RegExp(`^${word} kokt`) });
    const swedish = sheet(page).getByRole("button", { name: new RegExp(`^${word} salad with feta`, "i") });
    await expect(home).toBeVisible();
    await expect(swedish).toBeVisible();
    await expect(swedish).toContainText("Sweden");
    await expect(swedish).toContainText("Livsmedelsverket ·");
    await expect(home).not.toContainText("Norway");
    await expect(home).toContainText(`${word} boiled ·`);

    // The home table's food comes first, though the Swedish one matches just as well.
    const order = await sheet(page).locator(".rtext .t-body").allTextContents();
    expect(order.indexOf(`${word} kokt`)).toBeLessThan(order.findIndex((text) => text.toLowerCase().startsWith(`${word} salad`)));

    const results = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
    const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
    expect(serious.map((item) => item.id)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("origin-results.png") });

    await swedish.click();
    await expect(sheet(page).getByRole("heading", { name: new RegExp(`${word} salad with feta`, "i") })).toBeVisible();
    await sheet(page).getByLabel("Amount in g").fill("200");
    await sheet(page).getByRole("button", { name: /Add · 360 kcal/ }).click();
    await expect(page.getByText(new RegExp(`Added 200 g ${word} salad with feta · 360 kcal`, "i"))).toBeVisible();

    const day = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
    expect(day.ok(), await day.text()).toBeTruthy();
    expect(JSON.stringify(await day.json())).toContain(`${word} salad with feta`);
  } finally {
    retireCatalogue(tag);
  }
});
