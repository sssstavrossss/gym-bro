import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

async function gaps(page: Page) {
  return page.evaluate(() => {
    const chev = document.querySelector(".chev")!.getBoundingClientRect();
    const macros = document.querySelector("main.today .macros")!.getBoundingClientRect();
    const blocks = [...document.querySelectorAll("main.today .macros, main.today .prompt, main.today .home-progress")]
      .map((node) => node.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    const between = [];
    for (let i = 1; i < blocks.length; i += 1) between.push(blocks[i].top - blocks[i - 1].bottom);
    const grab = document.querySelector(".grab") as HTMLElement;
    const box = grab.getBoundingClientRect();
    const extra = getComputedStyle(grab, "::after");
    return {
      visual: macros.top - chev.bottom,
      blocks: between,
      hit: extra.position === "absolute" ? parseFloat(extra.height) : box.height,
      face: box.height,
    };
  });
}

async function stamp(page: Page, label: string) {
  await page.evaluate((title) => {
    document.querySelector("[data-gap-stamp]")?.remove();
    const chev = document.querySelector(".chev")!.getBoundingClientRect();
    const macros = document.querySelector("main.today .macros")!.getBoundingClientRect();
    const blocks = [...document.querySelectorAll("main.today .macros, main.today .prompt, main.today .home-progress")]
      .map((node) => node.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    const visual = Math.round(macros.top - chev.bottom);
    const other = blocks.length > 1 ? Math.round(blocks[1].top - blocks[0].bottom) : visual;
    const note = document.createElement("div");
    note.dataset.gapStamp = title;
    note.textContent = `${title}: grabber to next block ${visual}px, other blocks ${other}px`;
    note.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:50;padding:6px 8px;border-radius:8px;background:#fff;color:#000;font:600 13px/1.2 Inter,sans-serif;";
    document.body.appendChild(note);
  }, label);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("the grabber sits one standard gap above the next Home block", async ({ page }) => {
  const oid = `e2e-gap-${Date.now()}-${test.info().project.name}`;
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
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.removeItem("gymbro-home-week-open");
    document.documentElement.classList.add("demo-statusbar");
  }, oid);
  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  await expect(page.locator("main.today .macros")).toBeVisible();
  await expect(page.locator("main.today .home-progress")).toBeVisible();

  const closed = await gaps(page);
  expect(closed.hit).toBeGreaterThanOrEqual(44);
  expect(closed.face).toBeLessThan(44);
  expect(closed.blocks.length).toBeGreaterThan(0);
  expect(closed.visual).toBeCloseTo(closed.blocks[0], 0);

  if (test.info().project.name === "chromium") {
    await stamp(page, "After, collapsed");
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone44-gap-collapsed-after.png" });
    await page.evaluate(() => document.querySelector("[data-gap-stamp]")?.remove());
  }

  await page.getByRole("button", { name: "Show the last 4 weeks" }).click();
  await expect.poll(async () => page.locator(".homeweek .stage").evaluate((node) => node.style.height)).toBe("auto");
  const open = await gaps(page);
  expect(open.hit).toBeGreaterThanOrEqual(44);
  expect(open.visual).toBeCloseTo(open.blocks[0], 0);
  expect(open.visual).toBeCloseTo(closed.visual, 0);

  if (test.info().project.name === "chromium") {
    await stamp(page, "After, expanded");
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone44-gap-expanded-after.png" });
  }
});
