// New-feature and state screenshots -> shots/states/ (phone 393×852 @2x unless the name says otherwise).
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = pathToFileURL(path.join(root, "gymbro-prototype.html")).href;
const out = (n) => path.join(root, "shots", "states", n + ".png");
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
const log = (...a) => console.log(...a);

async function session(kind) {
  const opts = kind === "phone" ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : kind === "tablet" ? { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const q = kind === "phone" ? "?statusbar&now=17:20" : "?now=17:20";
  const settle = (ms = 450) => page.waitForTimeout(ms);
  const go = async (hash, demo) => { await page.goto(`${base}${q}${demo ? "&demo=" + demo : ""}#${hash}`); await page.evaluate(() => document.fonts.ready); await settle(); };
  const shot = async (n, { toast = false, full = false } = {}) => { await settle(); if (!toast) await page.locator(".toast").waitFor({ state: "detached", timeout: 7000 }); await page.screenshot({ path: out(n), fullPage: full }); log("shot", n); };
  const reset = async () => { await go("/today"); await page.evaluate(() => localStorage.clear()); await page.reload(); await settle(); };
  return { ctx, page, go, shot, settle, reset };
}
async function longPress(page, locator, ms = 650) {
  const b = await locator.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// ---------------- Phone ----------------
{
  const { page, go, shot, settle, reset, ctx } = await session("phone");
  await reset();
  // Timeline
  await go("/log"); await shot("p01-timeline");
  await go("/log/2026-10-22"); await shot("p02-timeline-past-day-over");
  // Select mode via long-press
  await go("/log");
  await longPress(page, page.locator(".frow", { hasText: "Greek yogurt" }));
  await settle();
  log("long-press → selecting:", await page.locator(".sbar").count() === 1);
  for (const n of ["Rolled oats", "Blueberries", "Peanut butter"]) await page.locator(".frow", { hasText: n }).click();
  await shot("p03-select-mode");
  await page.click(".sbar .act:has-text('Copy to')"); await shot("p04-copy-to");
  await page.click(".opt:has-text('Yesterday')"); await page.waitForTimeout(150); await shot("p04b-copy-to-yesterday");
  await page.click(".cbtn[aria-label='Close']"); await settle();
  await page.click(".sbar .act:has-text('Save as group')"); await page.fill(".sheet input[type=text]", "Weekend breakfast"); await shot("p05-save-as-group");
  await page.click(".sheet .primary-btn"); await shot("p05b-group-saved-toast", { toast: true });
  // Groups in the food sheet + session bar
  await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); await settle();
  await page.click(".grp:has-text('Post-gym shake') .rtext"); await shot("p06-food-sheet-saved-groups");
  await page.click(".grp:has-text('Post-gym shake') .cbtn"); await settle(300);
  await page.click(".rrow:not(.grp):has-text('Salmon') .cbtn"); await settle(300);
  await shot("p07-session-bar-save-as-group", { toast: true });
  await page.click(".session .chip:has-text('Save as group')"); await settle();
  await page.click(".cbtn[aria-label='Close']"); await settle(); // back to food sheet
  // time chip: log at a chosen time
  await page.locator(".tchip input").fill("08:15"); await page.locator(".tchip input").dispatchEvent("change"); await settle();
  await page.click(".rrow:not(.grp):has-text('Chicken breast') .rtext"); await shot("p08-detail-at-chosen-time");
  await page.click(".cbtn[aria-label='Back']"); await page.click(".session .chip.on"); await settle();
  // Edit: time editable + delete
  await go("/log"); await page.locator(".frow", { hasText: "Almonds" }).click(); await settle();
  await shot("p09-edit-entry-time-delete");
  await page.click(".cbtn[aria-label='Close']"); await settle();
  // Past day add: time picker emphasised
  await go("/log/2026-10-20"); await page.click(".addrow"); await settle(); await shot("p10-add-to-past-day-pick-time");
  await page.click(".grp:has-text('Post-gym shake') .cbtn"); await settle(); await shot("p10b-past-day-group-asks-time");
  await page.locator(".tchip input").fill("16:10"); await page.locator(".tchip input").dispatchEvent("change"); await settle();
  await shot("p10c-past-day-time-picked", { toast: true });
  await page.click(".session .chip.on"); await settle();
  // Macro balance
  await reset(); await go("/profile");
  await page.locator(".mb").evaluate((e) => e.scrollIntoView({ block: "center" })); await shot("p11-macro-balance-collapsed");
  await page.click(".mb .head"); await page.click(".seg-btn:has-text('More · 2.4')"); await page.locator(".mb").evaluate((e) => e.scrollIntoView({ block: "start" })); await shot("p12-macro-balance-more-protein");
  await page.click(".mb .link:has-text('Exact numbers')"); await page.click("[aria-label='More protein']"); await page.click("[aria-label='More fat']");
  await page.locator(".mb").evaluate((e) => e.scrollIntoView({ block: "start" })); await shot("p13-macro-balance-exact");
  log("macro summary:", await page.locator(".mb .head").innerText());
  await page.click(".mb .link:has-text('Reset to default')");
  // Demo states switcher
  await page.click(".demo .dhead"); await page.locator(".demo").evaluate((e) => e.scrollIntoView({ block: "end" })); await shot("p14-demo-states-switcher");
  // Onboarding
  await go("/today", "onboarding"); await shot("p15-onboarding-welcome");
  await page.click(".primary-btn"); await page.click(".seg-btn:has-text('Male')"); await page.fill("input[placeholder='e.g. 1990']", "1990"); await page.fill("input[placeholder='e.g. 180']", "180"); await shot("p16-onboarding-about-you");
  await page.click(".primary-btn"); await page.fill("input[aria-label='Weight in kg']", "83,6"); await shot("p17-onboarding-weight");
  await page.click(".primary-btn"); await page.click(".opt:has-text('Moderate')"); await shot("p18-onboarding-activity");
  await page.click(".primary-btn"); await page.click(".seg-btn:has-text('Lose')"); await page.click(".rates .chip:has-text('0.5')"); await page.fill("input[placeholder='e.g. 80']", "80"); await shot("p19-onboarding-goal");
  await page.click(".primary-btn"); await shot("p20-onboarding-targets");
  log("onboarding targets:", (await page.locator(".tg").innerText()).replace(/\n/g, " "));
  await page.click(".primary-btn"); await settle(); await shot("p21-after-onboarding-today", { toast: true });
  // Empty account
  await go("/today", "empty"); await shot("p22-empty-today");
  await go("/log", "empty"); await shot("p23-empty-log");
  await go("/progress", "empty"); await shot("p24-empty-progress");
  await go("/today", "empty"); await page.click(".wcard"); await settle(); await page.locator(".winput").blur(); await shot("p25-empty-weight-sheet");
  await page.click(".cbtn[aria-label='Close']");
  await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); await shot("p26-empty-food-sheet");
  // Low accuracy (S8)
  await go("/today", "lowacc"); await shot("p27-low-accuracy-today");
  await page.click(".wcard"); await settle(); await page.locator(".winput").blur(); await shot("p28-low-accuracy-weight-sheet");
  await go("/profile", "lowacc"); await shot("p29-low-accuracy-profile");
  // Loading
  await go("/today", "loading"); await shot("p30-loading-today");
  await go("/log", "loading"); await shot("p31-loading-log");
  await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); await page.fill(".field input", "ch"); await shot("p32-loading-food-search");
  // Food search failing
  await go("/today", "offline"); await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); await page.fill(".field input", "salm"); await shot("p33-error-food-search");
  await page.fill(".field input", "chick"); await shot("p33b-error-food-search-local-match");
  // Server unreachable
  await go("/today", "unreachable"); await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')");
  await page.click(".rrow:not(.grp):has-text('Banana') .rtext"); await page.click(".primary-btn"); await shot("p34-error-save-failed");
  await ctx.close();
}

// ---------------- Desktop ----------------
{
  const { page, go, shot, settle, reset, ctx } = await session("desktop");
  await reset();
  await go("/today", "onboarding"); await page.click(".ob .primary-btn"); await shot("d01-1440-onboarding");
  await go("/today", "empty"); await shot("d02-1440-empty-today");
  await go("/today", "lowacc"); await shot("d03-1440-low-accuracy");
  await go("/today", "loading"); await shot("d04-1440-loading");
  await go("/today", "offline"); await page.keyboard.press("n"); await settle(); await page.keyboard.type("salm"); await shot("d05-1440-error-food-search");
  await go("/today"); await page.keyboard.press("n"); await settle(); await shot("d06-1440-food-saved-groups");
  await page.keyboard.press("Escape");
  await go("/log"); await page.locator(".frow", { hasText: "Whey" }).click({ modifiers: ["Control"] });
  await page.locator(".frow", { hasText: "Banana" }).click({ modifiers: ["Control"] }); await page.mouse.move(600, 880);
  await page.click(".sbar .act:has-text('Save as group')"); await page.keyboard.type("Shake + banana"); await shot("d07-1440-save-as-group");
  await page.keyboard.press("Escape"); await settle();
  await go("/profile"); await page.click(".mb .head"); await page.click(".mb .link:has-text('Exact numbers')"); await settle();
  await page.locator(".mb input[aria-label^='Protein']").fill("2,2"); await page.locator(".mb input[aria-label^='Protein']").press("Tab");
  await shot("d08-1440-macro-balance-exact-typed");
  log("typed 2,2 → summary:", await page.locator(".mb .head").innerText());
  await ctx.close();
}
// ---------------- Tablet ----------------
{
  const { page, go, shot, reset, ctx } = await session("tablet");
  await reset();
  await go("/log"); await page.click(".dayline .chip:has-text('Select')"); await page.locator(".frow", { hasText: "Chicken" }).click(); await page.locator(".frow", { hasText: "Basmati" }).click(); await shot("t01-820-select");
  await go("/today", "onboarding"); await shot("t02-820-onboarding");
  await ctx.close();
}
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
