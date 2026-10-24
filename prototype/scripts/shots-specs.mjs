// Shots for the "Specs awaiting design" batch (item 0, S1–S5, S7) -> shots/specs/. Phone 393×852 @2x, desktop 1440, tablet 820.
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const base = pathToFileURL(path.join(root, "gymbro-prototype.html")).href;
const out = (n) => path.join(root, "shots", "specs", n + ".png");
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
let seq = 0;
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
  const go = async (hash, demo = "normal") => { await page.goto(`${base}${q}&demo=${demo}&s=${++seq}#${hash}`); await page.evaluate(() => document.fonts.ready); await settle(); };
  const shot = async (n, { toast = false } = {}) => { await settle(); if (!toast) await page.locator(".toast").waitFor({ state: "detached", timeout: 7000 }); await page.screenshot({ path: out(n) }); console.log("shot", n); };
  const openAdd = async () => { if (kind === "desktop") await page.keyboard.press("n"); else { await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); } await settle(); };
  const scrollTo = async (sel) => { await page.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "start" })); await settle(200); };
  return { ctx, page, go, shot, settle, openAdd, scrollTo };
}

// ---------------- Phone ----------------
{
  const { page, go, shot, settle, openAdd, scrollTo, ctx } = await session("phone");
  await go("/today"); await page.click(".wcard .ibtn"); await shot("p00-trend-info-today");
  await page.keyboard.press("Escape"); await page.click(".wcard .stretch"); await settle(); await page.locator(".winput").blur(); await scrollTo(".thint"); await shot("p01-weight-sheet-trend-hint");
  // S1
  await go("/profile"); await scrollTo(".targets"); await shot("p10-profile-current-target-since");
  await page.click(".hist .more"); await scrollTo(".hist"); await shot("p11-profile-target-history");
  await go("/log/2026-09-16"); await shot("p12-log-no-target-day");
  await go("/progress/2026-09"); await shot("p13-progress-sep-no-target-days");
  // S2
  await go("/today"); await openAdd(); await shot("p20-recents-remember-units");
  await page.click(".rrow:not(.grp):has-text('Eggs') .rtext"); await shot("p21-detail-unit-picker-pieces");
  await page.click(".cbtn[aria-label='Back']"); await page.fill(".field input", "bread"); await page.click(".rrow:has-text('Wholemeal') .rtext");
  await page.click(".uchip:has-text('slice')"); await page.click(".uchip.add"); await page.fill(".svform input[aria-label='Serving name']", "slice (bakery)"); await page.fill(".svform input[aria-label='Grams in one serving']", "35"); await shot("p22-add-custom-serving");
  await page.click(".svform .chip.on"); await page.locator(".toast").waitFor({ state: "detached", timeout: 7000 }); await page.click(".key[aria-label='Delete']"); await page.click(".key[aria-label='2']"); await shot("p23-custom-serving-2-slices");
  await go("/log"); await page.locator(".frow", { hasText: "Whey" }).click(); await shot("p24-edit-entry-logged-unit-copy-to");
  // S3
  await go("/today"); await openAdd(); await page.click("button:has-text('My foods')"); await shot("p30-my-foods");
  await page.click("button:has-text('New food')"); await page.fill(".fe input[placeholder^='e.g. Lentil']", "Overnight oats, home-made");
  await page.click(".fe .seg-btn:has-text('Per serving')"); await page.fill(".fe input[aria-label='Serving size in grams']", "320");
  await page.fill(".fe input[aria-label^='Calories']", "520"); await page.fill(".fe input[aria-label^='Protein']", "28"); await page.fill(".fe input[aria-label^='Fat']", "12"); await page.fill(".fe input[aria-label^='Carbs']", "62");
  await page.locator(".fe input[aria-label^='Carbs']").blur(); await shot("p31-new-food-form-kcal-hint");
  await page.locator(".fe .grid4").evaluate((e) => e.scrollIntoView({ block: "start" })); await shot("p31b-new-food-form-lower");
  await go("/today"); await openAdd(); await page.click("button:has-text('My foods')"); await page.click(".ibtn44[aria-label^='Edit Protein bar']"); await shot("p32-edit-my-food-note");
  await go("/today"); await openAdd(); await page.fill(".field input", "bar"); await shot("p33-search-shows-my-food-label");
  await page.click(".seg-btn:has-text('Quick Add')"); await page.fill(".field input", "Café flat white");
  for (const k of ["1", "3", "0"]) await page.click(`.key[aria-label='${k}']`); await page.click(".qsave input"); await shot("p34-quick-add-save-as-my-food");
  // session bar fix
  await go("/today"); await openAdd(); for (const n of ["Salmon", "Banana", "Greek yogurt"]) { await page.click(`.rrow:not(.grp):has-text('${n}') .cbtn`); await settle(250); }
  await shot("p35-session-bar-3-added", { toast: true });
  // S4
  await go("/today", "down"); await shot("p40-server-unreachable");
  await go("/today"); await ctx.setOffline(true); await settle(); await shot("p41-offline");
  await page.click(".down .ghost"); await shot("p42-offline-read-only-banner"); await ctx.setOffline(false);
  // S5
  await go("/progress"); await shot("p50-progress-ticks-hatch-no-colour-alone");
  await go("/log"); await shot("p51-log-contrast-tokens");
  // S7
  await go("/profile", "manual"); await scrollTo(".goal"); await shot("p70-profile-my-own-number");
  await page.fill("#manual-kcal", "1500"); await page.press("#manual-kcal", "Enter"); await settle(); await shot("p71-profile-below-bmr-warning");
  await page.fill("#manual-kcal", "1990.5"); await page.press("#manual-kcal", "Enter"); await settle(); await shot("p72-profile-manual-validation");
  await go("/profile", "manual"); await page.click(".hist .more"); await scrollTo(".targets"); await shot("p73-profile-targets-manual-tag");
  await scrollTo(".hist"); await shot("p74-target-history-mode-switch");
  await go("/today", "manual"); await shot("p75-today-manual");
  await go("/log", "manual"); await shot("p76-log-manual-tag");
  await go("/log/2026-10-21", "manual"); await shot("p77-log-21-oct-rate-day");
  await go("/progress", "manual"); await scrollTo(".msum"); await shot("p78-progress-manual-days");
  await go("/today", "goalreached"); await shot("p79-goal-reached-question");
  await go("/profile", "goalreached"); await scrollTo(".gr"); await shot("p79b-goal-reached-profile");
  await ctx.close();
}
// ---------------- Desktop ----------------
{
  const { page, go, shot, settle, openAdd, ctx } = await session("desktop");
  await go("/today"); await page.click(".wbig .ibtn"); await shot("d00-trend-info");
  await go("/profile"); await page.click(".hist .more"); await shot("d10-profile-target-history");
  await go("/log/2026-09-16"); await shot("d11-log-no-target");
  await go("/today"); await openAdd(); await page.click(".rrow:not(.grp):has-text('Eggs') .rtext"); await shot("d20-food-detail-units");
  await go("/today"); await openAdd(); await page.click("button:has-text('New food')"); await shot("d30-new-food");
  await go("/today", "down"); await shot("d40-server-unreachable");
  await go("/today"); for (let i = 0; i < 9; i++) await page.keyboard.press("Tab"); await shot("d50-keyboard-focus-ring");
  await go("/today", "manual"); await shot("d70-today-manual-this-week");
  await go("/profile", "manual"); await shot("d71-profile-manual");
  await go("/today", "goalreached"); await shot("d72-goal-reached");
  await go("/progress", "manual"); await shot("d73-progress-manual");
  await ctx.close();
}
// ---------------- Tablet ----------------
{
  const { page, go, shot, openAdd, ctx } = await session("tablet");
  await go("/profile"); await shot("t10-profile-history");
  await go("/today"); await openAdd(); await page.click(".rrow:not(.grp):has-text('Whey') .rtext"); await shot("t20-food-detail-scoop-no-sliver");
  await go("/today", "manual"); await shot("t70-today-manual");
  await go("/today", "down"); await shot("t40-server-unreachable");
  await ctx.close();
}
console.log(errors.length ? "ERRORS:\n" + [...new Set(errors)].join("\n") : "no console errors");
await browser.close();
