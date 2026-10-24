// S8 Part A screenshots -> shots/s8/ (phone 393×852 @2x, desktop 1440×900).
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const root = path.resolve(import.meta.dirname, "..");
const base = pathToFileURL(path.join(root, "gymbro-prototype.html")).href;
const dir = path.join(root, "shots", "s8"); fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
for (const kind of ["phone", "desktop"]) {
  const ctx = await browser.newContext(kind === "phone" ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(String(e)));
  const q = kind === "phone" ? "?statusbar&now=17:20" : "?now=17:20";
  let n = 0;
  const settle = (ms = 450) => page.waitForTimeout(ms);
  const go = async (hash, demo) => { await page.goto(`${base}${q}&s=${++n}${demo ? "&demo=" + demo : ""}#${hash}`); await page.evaluate(() => document.fonts.ready); await settle(); };
  const shot = async (name) => { await settle(); await page.locator(".toast").waitFor({ state: "detached", timeout: 7000 }).catch(() => {}); const f = path.join(dir, `${kind}-${name}.png`); await page.screenshot({ path: f }); console.log(f); };
  const card = kind === "phone" ? ".wcard" : ".wbig";
  await go("/today", "normal"); await shot("01-normal-today-one-line");
  await go("/today", "lowacc"); await shot("02-low-accuracy-today");
  await page.locator(`${card} .accdot`).click(); await settle(); await shot("03-low-accuracy-sheet");
  await go("/today", "lowacc"); await page.locator(`${card} .stretch`).click(); await settle(); await page.locator(".winput").blur(); await shot("04-low-accuracy-weight-sheet");
  await go("/profile", "lowacc"); if (kind === "phone") await page.locator(".frow:has-text('Weight')").first().scrollIntoViewIfNeeded(); await shot("05-low-accuracy-profile");
  await go("/today", "fresh"); await shot("06-fresh-start-today");
  await page.locator(`${card} .stretch`).click(); await settle(); await page.locator(".winput").blur(); await shot("07-fresh-start-weight-sheet");
  await go("/today", "typo"); await shot("08-typo-guard");
  await go("/today", "onboarding"); await page.click(".ob .primary-btn"); await page.click(".ob .seg-btn:has-text('Male')");
  await page.fill(".ob input[placeholder='e.g. 1990']", "1990"); await page.fill(".ob input[placeholder='e.g. 180']", "180"); await page.click(".ob .primary-btn");
  await page.fill(".ob input[aria-label='Weight in kg']", "84,0"); await shot("09-setup-starting-weight");
  await page.click(".ob .primary-btn"); await page.click(".ob .opt:has-text('Moderate')"); await page.click(".ob .primary-btn");
  await page.click(".ob .seg-btn:has-text('Lose')"); await page.click(".ob .rates .chip:has-text('0.5')"); await page.fill(".ob input[placeholder='e.g. 80']", "80"); await page.click(".ob .primary-btn");
  await page.click(".ob .primary-btn"); await settle(2500); await shot("10-after-setup-trend-with-dot");
  await ctx.close();
}
console.log(errors.length ? "ERRORS " + errors.join("\n") : "no page errors");
await browser.close();
