import { expect, test, type Page } from "@playwright/test";

const themes = [
  ["graphite", "rgb(22, 24, 29)", "#16181D"],
  ["midnight", "rgb(18, 24, 38)", "#121826"],
  ["charcoal", "rgb(26, 24, 22)", "#1A1816"],
  ["black", "rgb(0, 0, 0)", "#000000"],
] as const;

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("the status bar stays clear and the tab bar uses one bottom inset", async ({ page }) => {
  const oid = `e2e-topbar-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 84, timeZone: when.zone } })).ok()).toBeTruthy();
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
    document.documentElement.classList.add("demo-statusbar");
  }, oid);

  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "default");
  await expect(page.locator("main.today .topbar")).not.toContainText(/January|February|March|April|May|June|July|August|September|October|November|December/);
  await expect(page.getByRole("group", { name: "This week" })).toBeVisible();

  const weekTop = await page.getByRole("group", { name: "This week" }).evaluate((el) => el.getBoundingClientRect().top);
  expect(weekTop).toBeGreaterThanOrEqual(54);

  for (const path of ["/today", "/log", "/progress", "/profile"]) {
    await page.goto(path);
    await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
    for (const [id, background, token] of themes) {
      await page.evaluate(([theme, color]) => {
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
      }, [id, token] as const);
      await expectClearTop(page, 54, background);
    }
  }

  await page.evaluate(() => { document.documentElement.dataset.theme = "graphite"; });
  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const bar = page.locator("nav.tabbar");
  const metrics = await bar.evaluate((el) => {
    const style = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    return {
      height: parseFloat(style.height),
      paddingBottom: style.paddingBottom,
      sab: root.getPropertyValue("--sab").trim(),
    };
  });
  expect(metrics.sab).toBe("34px");
  expect(metrics.paddingBottom).toBe("0px");
  expect(metrics.height).toBeCloseTo(84, 0);
  for (const tab of await bar.locator(".tab").all()) {
    const box = await tab.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  const plus = await bar.locator(".plus").boundingBox();
  expect(plus?.width ?? 0).toBeCloseTo(56, 0);
  expect(plus?.height ?? 0).toBeCloseTo(56, 0);

  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-top.png", clip: { x: 0, y: 0, width: 390, height: 280 } });
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-tabbar.png", clip: { x: 0, y: 664, width: 390, height: 180 } });
  }
});

async function expectClearTop(page: Page, limit: number, background: string) {
  const strip = page.locator("[data-safe-top]");
  await expect(strip).toHaveCSS("background-color", background);
  await expect(strip).toHaveCSS("height", `${limit}px`);
  const blurred = await page.evaluate((top) => {
    return [...document.querySelectorAll("body *")].flatMap((el) => {
      if (!(el instanceof HTMLElement)) return [];
      const style = getComputedStyle(el);
      const filter = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter") || "none";
      const mask = style.maskImage || style.getPropertyValue("-webkit-mask-image") || "none";
      if ((filter === "none" || filter === "") && (mask === "none" || mask === "")) return [];
      const box = el.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= top) return [];
      return [`${el.tagName}.${el.className}`];
    });
  }, limit);
  expect(blurred).toEqual([]);
  const offenders = await page.evaluate((top) => {
    return [...document.querySelectorAll("body *")].flatMap((el) => {
      if (!(el instanceof HTMLElement)) return [];
      if (el.closest("[data-safe-top]") || el.classList.contains("sr-only") || el.classList.contains("app") || el.classList.contains("scroller")) return [];
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return [];
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || box.bottom <= 0 || box.top >= top - 0.5) return [];
      const paints = style.backgroundColor !== "rgba(0, 0, 0, 0)"
        || parseFloat(style.borderTopWidth) > 0
        || [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
      if (!paints) return [];
      return [`${el.tagName}.${el.className} top=${box.top.toFixed(1)}`];
    });
  }, limit);
  expect(offenders).toEqual([]);
}
