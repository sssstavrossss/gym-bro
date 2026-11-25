import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";

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

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const PAGES = ["Weight", "Calories", "Protein", "Fat", "Carbs", "Fibre", "Saturated fat", "Sodium", "Burn"];

/** Nine pages are too many for 44px dots on a phone, so the dot strip only shows where you are. Step with Next panel. */
async function showPage(progress: Locator, title: string) {
  const heading = progress.locator("[data-progress-title]");
  let at = PAGES.indexOf(await heading.innerText());
  while (PAGES[at] !== title) {
    at = (at + 1) % PAGES.length;
    await progress.getByRole("button", { name: "Next panel" }).last().click();
    await expect(heading).toHaveText(PAGES[at]);
    // A tap during the snap is lost, so wait for the track to stop.
    await progress.locator(".track").evaluate((track) => new Promise<void>((done) => {
      let last = -1;
      let still = 0;
      const tick = () => {
        still = track.scrollLeft === last ? still + 1 : 0;
        last = track.scrollLeft;
        if (still >= 6) done();
        else requestAnimationFrame(tick);
      };
      tick();
    }));
  }
}

async function showInView(page: Page, locator: ReturnType<Page["locator"]>, edge: "start" | "end" = "start") {
  await locator.evaluate((el, which) => {
    const scroller = el.closest(".scroller");
    if (!scroller) return;
    const bar = document.querySelector(".tabbar")?.getBoundingClientRect().height ?? 84;
    const rect = el.getBoundingClientRect();
    const viewTop = 8;
    const viewBottom = window.innerHeight - bar - 8;
    if (which === "end") scroller.scrollTop += rect.bottom - viewBottom;
    else scroller.scrollTop += rect.top - viewTop;
  }, edge);
}

test("home title, progress pickers, and remembered metric", async ({ page }) => {
  const oid = `e2e-home-progress-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  const yesterday = shift(when.today, -1);
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
    "-c", `UPDATE profiles SET created_at = created_at - interval '40 days' WHERE user_id = '${oid}'; UPDATE target_history SET effective_date = effective_date - 40 WHERE user_id = '${oid}';`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
  const weighRows = [];
  for (let ago = 24; ago >= 1; ago -= 1) {
    const date = shift(when.today, -ago);
    const kg = (86 - (24 - ago) * 0.08).toFixed(1);
    weighRows.push(`(gen_random_uuid(), '${oid}', '${date}', ${kg}, now())`);
  }
  execFileSync("psql", [
    "-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro",
    "-c", `INSERT INTO weigh_ins (id, user_id, local_date, kg, updated_at) VALUES ${weighRows.join(",")}`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
  for (let ago = 24; ago >= 2; ago -= 2) {
    const saved = await page.request.post("/api/log-entries", {
      headers: headers(oid),
      data: {
        idempotencyKey: `${oid}-day-${ago}`,
        localDate: shift(when.today, -ago),
        timeZone: when.zone,
        time: "12:30",
        name: "Fictional lunch bowl",
        kcal: 1900 + ago * 10,
        protein: 120 + ago,
        fat: 55,
        carbs: 200,
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  expect((await page.request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${oid}-oats`,
      localDate: when.today,
      timeZone: when.zone,
      time: "08:15",
      name: "Fictional morning oats",
      kcal: 400,
      protein: 20,
      fat: 8,
      carbs: 40,
    },
  })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    if (!sessionStorage.getItem("gymbro-e2e-kept")) {
      localStorage.removeItem("gymbro-home-metric");
      localStorage.removeItem("gymbro-home-range");
      localStorage.removeItem("gymbro-home-progress-page");
      sessionStorage.setItem("gymbro-e2e-kept", "1");
    }
  }, oid);

  await page.goto("/today");
  const main = page.getByRole("main", { name: "Today" });
  await expect(main.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.locator(".wcard")).toHaveCount(0);
  await expect(main.getByText(/fasting/i)).toHaveCount(0);
  const progress = page.getByRole("region", { name: "Progress", exact: true });
  await expect(progress.locator("[data-progress-title]")).toHaveText("Weight");
  await expect(page.getByRole("radio", { name: "30d", exact: true })).toBeChecked();
  const chart = page.getByRole("img", { name: "Weight chart" });
  await expect(chart).toBeVisible();
  await expect(page.locator("[data-home-summary]")).toContainText("latest 83.6");
  await expect(page.getByText("Daily averages")).toHaveCount(0);
  // One range switch inside the card: five equal segments, a 30px face with 44px tap areas.
  const seg = await progress.getByRole("radiogroup", { name: "Chart range" }).evaluate((row) => {
    const box = row.getBoundingClientRect();
    const card = row.closest(".card")!.getBoundingClientRect();
    const buttons = [...row.querySelectorAll("button")];
    const widths = buttons.map((button) => button.getBoundingClientRect().width);
    const after = getComputedStyle(buttons[0], "::after");
    const hit = buttons[0].getBoundingClientRect().height + Math.abs(Math.min(0, parseFloat(after.top) || 0)) * 2;
    return { height: hit, inside: box.left >= card.left && box.right <= card.right, widths };
  });
  expect(seg.height).toBeGreaterThanOrEqual(44);
  expect(seg.inside).toBe(true);
  expect(seg.widths).toHaveLength(5);
  expect(Math.max(...seg.widths) - Math.min(...seg.widths)).toBeLessThanOrEqual(1);
  // The numbers under each chart sit centred in their column.
  const aligned = await page.locator("[data-home-summary] .cell").evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign));
  expect(aligned.every((value) => value === "center")).toBe(true);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone41-home-top.png" });
    await showInView(page, progress);
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone41-progress-weight-30d.png" });
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone41-progress-section.png" });
    await showPage(progress, "Protein");
    await showInView(page, progress);
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone41-progress-protein-30d.png" });
    await showPage(progress, "Weight");
    await showInView(page, page.locator("[data-home-summary]"), "end");
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone41-summary.png" });
    await page.evaluate(() => document.querySelector(".scroller")?.scrollTo(0, 0));
  }

  const top = await main.getByRole("heading", { level: 1 }).evaluate((el) => el.offsetTop);
  await page.getByRole("button", { name: "Weigh in" }).click();
  const sheet = page.getByRole("dialog", { name: "Log weight" });
  const field = sheet.getByRole("textbox", { name: "Weight in kilograms" });
  // The phone sheet types on the app keypad, so the system keyboard stays down.
  await expect(field).toHaveAttribute("inputmode", "none");
  await expect(sheet.getByRole("group", { name: "Number keypad" })).toBeVisible();
  await expect(field).not.toBeFocused();
  await page.keyboard.press("Escape");
  const topAfter = await main.getByRole("heading", { level: 1 }).evaluate((el) => el.offsetTop);
  expect(Math.abs(topAfter - top)).toBeLessThanOrEqual(1);

  const yesterdayName = await page.evaluate((iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(year, month - 1, day));
  }, yesterday);
  const week = page.getByRole("group", { name: "This week" });
  // Match the date too (the strip also holds next week's same weekday). On a Monday, yesterday is in the previous week.
  const yesterdayButton = week.getByRole("button", { name: new RegExp(`${yesterdayName} ${Number(yesterday.slice(8))},`) });
  if (!(await yesterdayButton.count())) {
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(yesterdayButton).toHaveCount(1);
  }
  await yesterdayButton.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(yesterday === shift(when.today, -1) ? "Yesterday" : yesterdayName);
  const headingY = await page.getByRole("heading", { level: 1 }).evaluate((el) => el.offsetTop);
  expect(Math.abs(headingY - top)).toBeLessThanOrEqual(1);

  const chartNode = page.locator(".home-progress [data-page='weight'] svg.fig");
  await expect(chartNode).toBeVisible();
  await showPage(progress, "Protein");
  await expect(page.getByRole("img", { name: "Protein chart" })).toBeVisible();
  await expect(page.getByText("Loading progress…")).toHaveCount(0);
  const period = page.locator(".home-progress .period");
  const thirty = await period.innerText();
  const rangeButton = page.getByRole("radio", { name: "7d", exact: true });
  await rangeButton.scrollIntoViewIfNeeded();
  const before = await page.locator(".scroller").first().evaluate((node) => node.scrollTop);
  await rangeButton.click();
  await expect(page.getByText("Loading progress…")).toHaveCount(0);
  await expect(chartNode).toBeVisible();
  await expect(period).not.toHaveText(thirty);
  await expect(page.getByText("Daily averages")).toHaveCount(0);
  const after = await page.locator(".scroller").first().evaluate((node) => node.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);

  await page.reload();
  await expect(progress.locator("[data-progress-title]")).toHaveText("Protein");
  await expect(page.getByRole("radio", { name: "7d", exact: true })).toBeChecked();
});

test("the Burn page draws the daily burn over the BMR, with today's numbers", async ({ page }) => {
  const oid = `e2e-home-burn-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  const progressBody = await (await page.request.get("/api/progress?range=30d", { headers: headers(oid) })).json();
  const burn = progressBody.burn as { kcal: number; bmrKcal: number; sdKcal: number; measured: boolean };
  // A new profile's burn is the formula's, ±350.
  expect(burn.measured).toBe(false);
  expect(burn.sdKcal).toBe(350);
  expect(burn.kcal).toBeGreaterThan(burn.bmrKcal);
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    if (!sessionStorage.getItem("gymbro-e2e-kept")) {
      localStorage.removeItem("gymbro-home-progress-page");
      sessionStorage.setItem("gymbro-e2e-kept", "1");
    }
  }, oid);

  await page.goto("/today");
  const progress = page.getByRole("region", { name: "Progress", exact: true });
  const title = progress.locator("[data-progress-title]");
  await expect(title).toHaveText("Weight");
  // Burn is the last page, so one step back from Weight wraps to it.
  await progress.getByRole("button", { name: "Previous panel" }).last().click();
  await expect(title).toHaveText("Burn");

  const burnPage = progress.locator(".ppage[data-page='burn']");
  await expect(burnPage.getByRole("img", { name: "Burn chart" })).toBeVisible();
  await expect(burnPage.locator("[data-burn-line]")).toHaveCount(1);
  await expect(burnPage.locator("[data-bmr-line]")).toHaveCount(1);
  await expect(burnPage.locator("[data-burn-activity]")).toHaveCount(1);
  const fmt = (value: number) => value.toLocaleString("en-US");
  await expect(burnPage.locator("[data-burn-label]")).toHaveText(fmt(burn.kcal));
  await expect(burnPage.locator("[data-bmr-label]")).toHaveText(`BMR ${fmt(burn.bmrKcal)}`);
  // The burn sits above the BMR.
  const [burnY, bmrY] = await Promise.all(["[data-burn-label]", "[data-bmr-label]"].map(async (selector) => (await burnPage.locator(selector).boundingBox())!.y));
  expect(burnY).toBeLessThan(bmrY);

  const cells = burnPage.locator(".pstats .cell");
  await expect(cells.nth(0)).toContainText("Burn");
  await expect(cells.nth(0)).toContainText(fmt(burn.kcal));
  await expect(cells.nth(0)).toContainText("±350 · formula");
  await expect(cells.nth(1)).toContainText(fmt(burn.bmrKcal));
  await expect(cells.nth(1)).toContainText("at rest");
  await expect(cells.nth(2)).toContainText(fmt(burn.kcal - burn.bmrKcal));
  await expect(cells.nth(2)).toContainText("burn − BMR");

  // It reopens on Burn.
  await page.reload();
  await expect(title).toHaveText("Burn");
});
