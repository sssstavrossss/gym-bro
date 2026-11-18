import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("Settings exports your data as a zip of CSV files and one JSON file", async ({ page }) => {
  const oid = `e2e-export-${Date.now()}-${test.info().project.name}`;
  await page.goto("/");
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
  expect((await page.request.post("/api/log-entries", {
    headers: headers(oid),
    data: { idempotencyKey: `${oid}-lunch`, localDate: when.today, timeZone: when.zone, time: "12:00", name: "Fictional lunch", kcal: 600, protein: 40, fat: 20, carbs: 60 },
  })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.goto("/profile");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const section = settings.locator("[data-export]");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole("heading", { name: "Your data" })).toBeVisible();

  const download = page.waitForEvent("download");
  await section.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`gym-bro-export-${when.today}.zip`);
  const bytes = await readFile((await file.path())!);
  // A zip starts with "PK", and its directory lists each file's name as plain text.
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  const names = bytes.toString("latin1");
  for (const name of ["profile.csv", "weigh-ins.csv", "targets.csv", "log.csv", "foods.csv", "recipes.csv", "groups.csv", "gym-bro.json"]) {
    expect(names).toContain(name);
  }
  await expect(section.getByRole("button", { name: "Export" })).toBeEnabled();
  await expect(section.getByRole("alert")).toHaveCount(0);
});
