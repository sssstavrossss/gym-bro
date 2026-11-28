import { expect, test, type Locator, type Page } from "@playwright/test";
import { pick } from "./dial";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function shift(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

/** A single-finger touch on the chart, dispatched the way a phone sends it. */
async function touch(target: Locator, type: "touchstart" | "touchmove" | "touchend", x: number, y: number) {
  await target.evaluate((el, a) => {
    const point = new Touch({ identifier: 1, target: el, clientX: a.x, clientY: a.y });
    el.dispatchEvent(new TouchEvent(a.type, { touches: a.type === "touchend" ? [] : [point], changedTouches: [point], bubbles: true, cancelable: true }));
  }, { type, x, y });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** A new account with weigh-ins 7 and 2 days ago, on 7d and the given page. */
async function setup(page: Page, startPage: number) {
  const oid = `e2e-progress-slide-${Date.now()}-${test.info().project.name}`;
  await page.goto("/");
  const when = await clock(page);
  // Weigh-ins 7 and 2 days ago: 8 days of history, so 7d can move back one day and every longer range fits it whole.
  // (Food can't be logged before setup and a new weigh-in goes back at most 7 days.)
  for (const [ago, kg] of [[7, 84.0], [2, 83.6]]) {
    const saved = await page.request.put(`/api/weigh-ins/${shift(when.today, -ago)}`, { headers: headers(oid), data: { kg, timeZone: when.zone } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  // 1y is the history up to a year: here, from the first weigh-in.
  const year = await (await page.request.get("/api/progress?range=1y", { headers: headers(oid) })).json();
  expect(year.from).toBe(shift(when.today, -7));
  expect(year.days).toHaveLength(8);
  await page.addInitScript(([id, at]) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.setItem("gymbro-home-range", "7d");
    localStorage.setItem("gymbro-home-progress-page", at);
  }, [oid, String(startPage)]);
}

test("the progress card moves through time on its strip and by holding the chart", async ({ page }) => {
  await setup(page, 0);

  await page.goto("/today");
  const progress = page.getByRole("region", { name: "Progress", exact: true });
  const weight = progress.locator(".ppage[data-page='weight']");
  const strip = weight.getByRole("slider", { name: "Days shown" });
  const period = progress.locator("[data-range-period]");
  await expect(strip).toHaveAttribute("aria-valuemax", "1");
  await expect(strip).toHaveAttribute("aria-valuenow", "1");
  await expect(period).toBeDisabled();
  const now = await period.innerText();
  // A 44px hit around the 36px strip.
  expect(Math.round((await strip.boundingBox())!.height)).toBe(44);
  const height = async () => Math.round((await progress.boundingBox())!.height);
  const tall = await height();

  // Tapping the strip's far left moves the window there.
  await strip.tap({ position: { x: 3, y: 22 } });
  await expect(period).not.toHaveText(now);
  await expect(period).toHaveClass(/moved/);
  await expect(period).toHaveAttribute("aria-label", /Back to now/);
  await expect(strip).toHaveAttribute("aria-valuenow", "0");
  const back = await period.innerText();

  // A range longer than the history fits it: the box covers the whole strip and nothing moves. The card keeps its height.
  await progress.getByRole("radio", { name: "30d", exact: true }).click();
  await expect(strip).toHaveAttribute("aria-disabled", "true");
  await expect(period).toBeDisabled();
  expect(await height()).toBe(tall);
  await progress.getByRole("radio", { name: "All", exact: true }).click();
  await expect(strip).toHaveAttribute("aria-disabled", "true");
  expect(await height()).toBe(tall);
  // Back on 7d, the stretch that was in view is in view again.
  await progress.getByRole("radio", { name: "7d", exact: true }).click();
  await expect(period).toHaveText(back);

  // The dates bring it back to now.
  await period.click();
  await expect(period).toHaveText(now);
  await expect(period).toBeDisabled();

  // The keyboard moves it a day at a time; End is now.
  await strip.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(period).toHaveText(back);
  await page.keyboard.press("End");
  await expect(period).toHaveText(now);

  await expect(progress.locator("[data-progress-title]")).toHaveText("Weight");

  // How far back isn't kept across a reload; the range is.
  await strip.focus();
  await page.keyboard.press("Home");
  await expect(period).toHaveText(back);
  await page.reload();
  await expect(progress.getByRole("radio", { name: "7d", exact: true })).toBeChecked();
  await expect(period).toHaveText(now);

  // Hold the chart, then drag right: the chart follows a day at a time and reads out the day under the finger.
  // (WebKit can't build a Touch from script, so the hold runs in Chromium.)
  test.skip(test.info().project.name === "webkit", "WebKit has no Touch constructor");
  const chart = weight.locator("[data-progress-chart]");
  const box = (await chart.boundingBox())!;
  const y = box.y + 60;
  await touch(chart, "touchstart", box.x + 100, y);
  await page.waitForTimeout(450);
  await expect(chart).toHaveClass(/held/);
  await expect(weight.locator("[data-progress-readout]")).toContainText(/ · /);
  for (let x = 120; x <= 260; x += 20) await touch(chart, "touchmove", box.x + x, y);
  await expect(period).toHaveText(back);
  await touch(chart, "touchend", box.x + 260, y);
  await expect(weight.locator("[data-progress-readout]")).toHaveCount(0);
  await expect(chart).not.toHaveClass(/held/);
  // The page didn't change under the drag.
  await expect(progress.locator("[data-progress-title]")).toHaveText("Weight");
});

test("a food log fetches only the week around it, compressed, and the card shows it", async ({ page }) => {
  await setup(page, 1);
  const asked: { url: string; encoding: string | undefined }[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/progress")) asked.push({ url: response.url(), encoding: response.headers()["content-encoding"] });
  });
  await page.goto("/today");
  const calories = page.getByRole("region", { name: "Progress", exact: true }).locator(".ppage[data-page='kcal']");
  const logged = calories.locator(".cell").filter({ hasText: "Logged" });
  await expect(logged.locator("[data-num]")).toHaveText("0 days");
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].url).toContain("range=1y");
  // Behind the dev proxy as in production, JSON comes back compressed.
  expect(["br", "gzip"]).toContain(asked[0].encoding);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Search", exact: true }).click();
  const sheet = page.getByRole("dialog").last();
  await sheet.getByRole("radio", { name: "Quick add" }).click();
  await pick(page, sheet.getByRole("button", { name: "Calories", exact: true }), 900);
  await sheet.getByRole("button", { name: /Add · 900 kcal/ }).click();
  await page.keyboard.press("Escape");

  await expect(logged.locator("[data-num]")).toHaveText("1 day");
  await expect(calories.locator(".cell").filter({ hasText: "Average" }).locator("[data-num]")).toHaveText("900");
  // Just today's week again, not the whole year.
  expect(asked.slice(1).map((row) => new URL(row.url).search)).toEqual(["?range=7d"]);
});
