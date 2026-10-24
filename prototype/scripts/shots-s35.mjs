// Decision 35 screenshots -> shots/s35/ (phone 393×852 @2x, desktop 1440×900).
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const root = path.resolve(import.meta.dirname, "..");
const base = pathToFileURL(path.join(root, "gymbro-prototype.html")).href;
const dir = path.join(root, "shots", "s35"); fs.mkdirSync(dir, { recursive: true });
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
  const sheet = async () => { await page.locator(".winput").blur().catch(() => {}); };
  await go("/today", "only"); await sheet(); await shot("01-only-weigh-in-blocked-delete");
  await page.click(".editb"); await shot("02-only-weigh-in-after-edit-tap");
  await go("/today", "zero7"); await shot("03-dot-sheet-0-in-7-days");
  await page.click(".sheet-root[aria-label='Trend accuracy'] .ghost"); await settle(); await shot("04-today-0-in-7-days");
  await go("/today", "datewin"); await sheet(); await shot("05-day-list-8-days");
  await page.click(".menu .opt:has-text('Sat, 17 Oct')"); await sheet(); await shot("06-closed-label-oldest-day");
  await go("/today", "normal"); await page.locator(`${card} .stretch`).click(); await settle(); await sheet(); await shot("07-normal-sheet-delete-still-offered");
  await go("/today", "only"); await sheet(); await page.locator(".sheet-root .chart-card").scrollIntoViewIfNeeded(); await shot("08-single-weigh-in-chart-centred");
  await ctx.close();
}
console.log(errors.length ? "ERRORS " + errors.join("\n") : "no page errors");
await browser.close();
