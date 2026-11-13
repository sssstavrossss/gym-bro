import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

async function putProfile(request: APIRequestContext, oid: string, zone: string) {
  const response = await request.put("/api/profile", {
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
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function putWeighIn(request: APIRequestContext, oid: string, date: string, zone: string) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg: 83.6, timeZone: zone },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function logQuick(request: APIRequestContext, oid: string, date: string, zone: string) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `leftover-${date}`,
      localDate: date,
      timeZone: zone,
      name: "Fictional leftover oats",
      time: "08:00",
      kcal: 400,
      protein: 30,
      fat: 5,
      carbs: 20,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Stores the prototype's manual-number reason on today's target. The UI only reads it. */
function storeManualReason(oid: string) {
  execFileSync("psql", [
    "-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro",
    "-c", `UPDATE target_history SET reasons = CASE WHEN 'manual_changed' = ANY(reasons) THEN reasons ELSE array_append(reasons, 'manual_changed') END WHERE user_id = '${oid}'`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector(".scroller");
    const root = document.documentElement;
    const scrollerOk = !scroller || scroller.scrollWidth <= scroller.clientWidth + 1;
    return root.scrollWidth <= root.clientWidth + 1 && scrollerOk;
  });
  expect(overflow).toBe(true);
}

test("Open log and the manual mark follow the stored target", async ({ page }) => {
  const oid = `e2e-leftover-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await logQuick(page.request, oid, when.today, when.zone);
  storeManualReason(oid);
  await sign(page, oid);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Open log")).toHaveCount(0);
  const mark = page.getByLabel("Manual target, my own number");
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("title", "Manual target (my own number)");
  await expectNoSideScroll(page);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/leftovers-phone.png" });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("link", { name: "Open log" })).toBeVisible();
  await expect(page.getByText("M = manual")).toBeVisible();
  const week = page.getByRole("region", { name: "This week" });
  await expect(week.getByLabel("Manual target, my own number")).toBeVisible();
  await expectNoSideScroll(page);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/leftovers-desktop.png" });
  }

  await page.getByRole("link", { name: "Open log" }).click();
  await expect(page).toHaveURL(new RegExp(`/log/${when.today}$`));
  await expect(page.getByRole("heading", { name: "Log", exact: true })).toBeVisible();
  await expect(page.getByLabel("Manual target, my own number")).toBeVisible();
});
