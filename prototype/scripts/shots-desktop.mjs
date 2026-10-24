// Desktop (1440×900) and tablet (820×1180) screenshots -> shots/desktop/
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const url = pathToFileURL(path.join(root, "gymbro-prototype.html")).href + "?now=17:20";
const out = (n) => path.join(root, "shots", "desktop", n + ".png");
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];

async function session(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const settle = () => page.waitForTimeout(450);
  const go = async (hash) => { await page.goto(url + "#" + hash); await page.evaluate(() => document.fonts.ready); await settle(); };
  const shot = async (n, full = false) => { await settle(); await page.locator(".toast").waitFor({ state: "detached", timeout: 6000 }); await page.screenshot({ path: out(n), fullPage: full }); console.log("shot", n); };
  return { ctx, page, go, shot, settle };
}

// ---- Desktop ----
{
  const { page, go, shot, settle, ctx } = await session({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  console.log("hover media:", await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches));
  await go("/today"); await page.evaluate(() => localStorage.clear()); await go("/profile"); await page.reload(); await settle();
  await go("/today"); await shot("1440-today");
  await go("/log");
  await page.locator(".frow", { hasText: "Chicken breast" }).hover(); await shot("1440-log-hover");
  // select: click the circle on one row, shift-click another → range
  await page.locator(".frow", { hasText: "Chicken breast" }).locator(".mark").click();
  await page.locator(".frow", { hasText: "Olive oil" }).locator(".mark").click({ modifiers: ["Shift"] });
  await page.mouse.move(700, 880); await shot("1440-log-select");
  console.log("selected:", await page.locator(".sbar .cnt").innerText());
  await page.click(".sbar .act:has-text('Copy to')"); await shot("1440-copy-to");
  await page.keyboard.press("Escape"); await settle(); await page.keyboard.press("Escape"); await settle();
  await go("/progress"); await shot("1440-progress");
  await go("/profile"); await page.click(".mb .head"); await shot("1440-profile");
  // Add food with the keyboard: N, type "chick", Enter, type 220, Enter
  await go("/today");
  await page.keyboard.press("n"); await settle();
  await page.keyboard.type("chick"); await settle();
  await shot("1440-add-food-search");
  await page.keyboard.press("Enter"); await settle();
  await page.keyboard.type("220"); await shot("1440-add-food-detail");
  console.log("button:", await page.locator(".primary-btn").innerText());
  await page.keyboard.press("Enter"); await settle();
  console.log("after Enter: back to list, session bar =", (await page.locator(".session").innerText()).replace(/\n/g, " | "));
  await page.keyboard.press("Escape"); await settle();
  console.log("kcal left:", await page.locator(".kcal .t-dxl").innerText());
  // Quick add via Q
  await page.keyboard.press("q"); await settle();
  await page.keyboard.type("Pizza slice"); await page.keyboard.press("Tab");
  await page.keyboard.press("Tab"); await page.keyboard.type("12"); await page.keyboard.press("Tab"); await page.keyboard.type("10"); await page.keyboard.press("Tab"); await page.keyboard.type("33");
  await shot("1440-quick-add");
  await page.keyboard.press("Enter"); await settle();
  await page.keyboard.press("Escape"); await settle();
  console.log("after quick add: kcal left:", await page.locator(".kcal .t-dxl").innerText());
  await page.keyboard.press("w"); await settle(); await shot("1440-weight");
  await page.keyboard.press("Escape"); await settle();
  console.log("Esc closes weight:", (await page.locator(".sheet-root").count()) === 0);
  await ctx.close();
}
// ---- 1100 (desktop, 2-column Today) ----
{
  const { go, shot, ctx } = await session({ viewport: { width: 1100, height: 860 }, deviceScaleFactor: 1 });
  await go("/today"); await shot("1100-today"); await ctx.close();
}
// ---- Touch screen at desktop width (G44): keypad + swipe, no hover actions ----
{
  const { page, go, shot, ctx } = await session({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await go("/today"); await page.evaluate(() => localStorage.clear()); await page.reload();
  await go("/today"); await page.keyboard.press("n"); await page.waitForTimeout(400);
  await page.click(".rrow:not(.grp):has-text('Chicken breast') .rtext"); await shot("1280-touch-add-food-keypad");
  console.log("touch @1280: keypad shown =", await page.locator(".keypad").count() > 0);
  await ctx.close();
}
// ---- Tablet ----
{
  const { page, go, shot, ctx } = await session({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await go("/today"); await page.evaluate(() => localStorage.clear()); await page.reload();
  await go("/today"); await shot("820-today");
  await go("/progress"); await shot("820-progress");
  await go("/log"); await shot("820-log");
  await go("/profile"); await shot("820-profile");
  await go("/today"); await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); await shot("820-add-food");
  await ctx.close();
}
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
