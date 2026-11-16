import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function shift(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monday(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

async function drag(page: Page, fromX: number, toX: number, y: number) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 16 });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("phone home pages the week strip and matches the range pills", async ({ page }) => {
  const oid = `e2e-week-swipe-${Date.now()}-${test.info().project.name}`;
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
  execFileSync("psql", [
    "-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro",
    "-c", `UPDATE profiles SET created_at = created_at - interval '40 days' WHERE user_id = '${oid}'`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    document.documentElement.classList.add("demo-statusbar");
  }, oid);

  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const week = page.getByRole("group", { name: "This week" });
  await expect(week).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous week" })).toHaveCount(1);
  const thisMonday = Number(monday(when.today).slice(8));
  await expect(week.getByRole("button").first()).toHaveAttribute("aria-label", new RegExp(`Monday ${thisMonday},`));
  const touch = await week.evaluate((el) => getComputedStyle(el).touchAction);
  expect(touch).toBe("pan-y");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-week-current.png" });
  }

  const box = await week.boundingBox();
  expect(box).toBeTruthy();
  const y = box!.y + box!.height / 2;
  await drag(page, box!.x + 30, box!.x + box!.width - 24, y);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-week-swipe.png" });
  }
  await page.mouse.up();
  const previousMonday = Number(shift(monday(when.today), -7).slice(8));
  await expect(week.getByRole("button").first()).toHaveAttribute("aria-label", new RegExp(`Monday ${previousMonday},`));
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Today");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-week-previous.png" });
  }

  await page.mouse.move(box!.x + box!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(week.getByRole("button").first()).toHaveAttribute("aria-label", new RegExp(`Monday ${previousMonday},`));
  // The Progress card is shorter than the old pills and summary, so scroll by what the page has.
  await page.locator(".scroller").first().evaluate((node) => { node.scrollTop = Math.min(180, node.scrollHeight - node.clientHeight); });
  await expect.poll(async () => page.locator(".scroller").first().evaluate((node) => node.scrollTop)).toBeGreaterThan(40);

  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(week.getByRole("button").first()).toHaveAttribute("aria-label", new RegExp(`Monday ${thisMonday},`));

  // Paging ahead is allowed: next week's days show but stay disabled, and today stays picked.
  const again = await week.boundingBox();
  await drag(page, again!.x + again!.width - 24, again!.x + 20, again!.y + again!.height / 2);
  await page.mouse.up();
  const nextMonday = Number(shift(monday(when.today), 7).slice(8));
  await expect(week.getByRole("button").first()).toHaveAttribute("aria-label", new RegExp(`Monday ${nextMonday},`));
  await expect(week.getByRole("button").first()).toBeDisabled();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  await page.goto("/log");
  await expect(page.getByRole("button", { name: "Previous week" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "This week" })).toBeVisible();

  await page.goto("/today");
  const range = page.getByRole("radio", { name: "30d", exact: true });
  const other = page.getByRole("radio", { name: "7d", exact: true });
  await expect(range).toBeChecked();
  const paint = async () => ({
    rangeBg: await range.evaluate((el) => getComputedStyle(el).backgroundColor),
    otherBg: await other.evaluate((el) => getComputedStyle(el).backgroundColor),
    // The compact switch draws a 30px face; its ::after keeps the tap area 44px.
    height: await range.evaluate((el) => el.getBoundingClientRect().height + Math.abs(Math.min(0, parseFloat(getComputedStyle(el, "::after").top) || 0)) * 2),
  });
  await page.evaluate(() => document.querySelector(".scroller")?.scrollTo(0, 600));
  const graphite = await paint();
  expect(graphite.height).toBeGreaterThanOrEqual(44);
  expect(graphite.rangeBg).toBe("rgb(255, 255, 255)");
  expect(graphite.otherBg).not.toBe(graphite.rangeBg);
  if (test.info().project.name === "chromium") {
    const progress = page.getByRole("region", { name: "Progress", exact: true });
    await progress.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-pills-graphite.png" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "midnight"; });
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone42-pills-midnight.png" });
    const midnight = await paint();
    expect(midnight.rangeBg).toBe("rgb(255, 255, 255)");
  }
});
