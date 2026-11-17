import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function monday(iso: string, weeks = 0) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + weeks * 7);
  return date.getUTCDate();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function setup(page: Page) {
  const oid = `e2e-week-nav-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  execFileSync("psql", [
    "-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro",
    "-c", `UPDATE profiles SET created_at = created_at - interval '40 days' WHERE user_id = '${oid}'`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    try { localStorage.setItem("gymbro-home-week-open", "0"); } catch { /* default is closed */ }
  }, oid);
  return when;
}

const firstDay = (page: Page) => page.getByRole("group", { name: "This week" }).getByRole("button").first();

test("the Home header names the week and its arrows turn it, ahead too", async ({ page }) => {
  const when = await setup(page);
  await page.goto("/today");
  const head = page.locator(".homehead");
  const back = head.getByRole("button", { name: "Previous week" });
  const ahead = head.getByRole("button", { name: "Next week" });
  const label = head.locator(".weeklbl");
  await expect(back).toBeVisible();
  await expect(label).toHaveText(new RegExp(`^${monday(when.today)} `));

  // Same 44px circle buttons as the Log's day switcher, inside the header row.
  for (const button of [back, ahead]) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const headBox = (await head.boundingBox())!;
  expect((await ahead.boundingBox())!.x + 44).toBeLessThanOrEqual(headBox.x + headBox.width + 0.5);

  await ahead.click();
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today, 1)},`));
  // Next week can be planned: its days open, and the same weekday is picked.
  await expect(firstDay(page)).toBeEnabled();
  await expect(label).toHaveText(new RegExp(`^${monday(when.today, 1)} `));
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Today");
  // Clicking a header arrow must not scroll the header sideways and clip the title.
  expect(await head.evaluate((el) => el.scrollLeft)).toBe(0);

  await back.click();
  await back.click();
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today, -1)},`));
  await expect(label).toHaveText(new RegExp(`^${monday(when.today, -1)} `));

  // Opening the calendar names its four weeks.
  await page.locator(".homeweek .grab").click();
  await expect(label).toHaveText(new RegExp(`^${monday(when.today, -4)} `));
  await page.locator(".homeweek .grab").click();
  await expect(label).toHaveText(new RegExp(`^${monday(when.today, -1)} `));
});

test("a short quick flick turns the week, and a short slow drag springs back without blocking the next", async ({ page }) => {
  const when = await setup(page);
  await page.goto("/today");
  const strip = page.locator(".homeweek .pager");
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today)},`));
  const box = (await strip.boundingBox())!;
  const y = box.y + box.height / 2;
  const mid = box.x + box.width / 2;

  // 36px, fast: well under the drag distance, but a flick.
  await page.mouse.move(mid, y);
  await page.mouse.down();
  await page.mouse.move(mid + 36, y, { steps: 3 });
  await page.mouse.up();
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today, -1)},`));

  // 36px, slow: springs back.
  await page.mouse.move(mid, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(mid + step * 6, y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today, -1)},`));

  // The spring-back used to leave the strip stuck. The next swipe still turns it.
  await page.mouse.move(mid, y);
  await page.mouse.down();
  await page.mouse.move(mid - 36, y, { steps: 3 });
  await page.mouse.up();
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today)},`));

  // A swipe a little off flat (40 across, 44 down) still counts as sideways.
  await page.mouse.move(mid, y - 20);
  await page.mouse.down();
  await page.mouse.move(mid - 40, y + 24, { steps: 4 });
  await page.mouse.up();
  await expect(firstDay(page)).toHaveAttribute("aria-label", new RegExp(`Monday ${monday(when.today, 1)},`));
});

test("at the largest text size the header keeps both arrows on one line", async ({ page }) => {
  await setup(page);
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
  const head = page.locator(".homehead");
  const headBox = (await head.boundingBox())!;
  for (const name of ["Previous week", "Next week"]) {
    const box = (await head.getByRole("button", { name }).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(headBox.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(headBox.y + headBox.height + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(headBox.x + headBox.width + 0.5);
  }
  const title = (await head.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual((await head.getByRole("button", { name: "Previous week" }).boundingBox())!.x);
});
