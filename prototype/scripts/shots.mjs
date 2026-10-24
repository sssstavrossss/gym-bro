// Phone screenshots of the main screens (headless Chrome via playwright-core).
// Usage: node scripts/shots.mjs   (expects gymbro-prototype.html to be built). Demo day is Sat 24 Oct 2026; ?now=17:20 pins the entry time.
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const url = pathToFileURL(path.join(root, "gymbro-prototype.html")).href + "?statusbar&now=17:20";
const out = (n) => path.join(root, "shots", n + ".png");
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Europe/Oslo" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const settle = () => page.waitForTimeout(450);
const shot = async (n, keepToast = false) => { await settle(); if (!keepToast) await page.locator(".toast").waitFor({ state: "detached", timeout: 7000 }); await page.screenshot({ path: out(n) }); console.log("shot", n); };
const go = async (hash) => { await page.goto(url + "#" + hash); await page.evaluate(() => document.fonts.ready); await settle(); };
const text = (sel) => page.locator(sel).first().innerText();

await go("/today"); await page.evaluate(() => localStorage.clear()); await go("/today");
await go("/profile"); await shot("1-profile");
await go("/today"); await shot("2-today");
const leftBefore = await text(".kcal .t-dxl");
await go("/log"); await shot("3-log");

// swipe "Chicken breast" left with a real drag
const row = page.locator(".swipe", { hasText: "Chicken breast" }).first();
const b = await row.boundingBox();
await page.mouse.move(b.x + b.width - 20, b.y + b.height / 2);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width - 20 - i * 18, b.y + b.height / 2 + 1);
await page.mouse.up();
await shot("3b-log-swipe");

// + chooser → food
await go("/today");
await page.click(".tabbar .plus"); await shot("plus-add-chooser");
await page.click(".tile:has-text('Food')"); await shot("4a-food-search");
await page.click(".rrow:not(.grp):has-text('Salmon') .cbtn"); await page.waitForTimeout(300);
await page.click(".rrow:not(.grp):has-text('Chicken breast') .rtext"); await shot("4b-food-detail");
await page.click(".key[aria-label='Delete']");
for (const k of ["2", "0", "0"]) await page.click(`.key[aria-label='${k}']`);
console.log("detail button after typing:", await text(".primary-btn"));
await page.click(".cbtn[aria-label='Back']");
await page.click(".seg-btn:has-text('Quick Add')");
await page.fill(".field input", "Protein bar");
await page.click(".qf:has-text('Protein')"); for (const k of ["3", "0"]) await page.click(`.key[aria-label='${k}']`);
await page.click(".qf:has-text('Fat')"); for (const k of ["1", "0"]) await page.click(`.key[aria-label='${k}']`);
await page.click(".qf:has-text('Carbs')"); for (const k of ["3", "5"]) await page.click(`.key[aria-label='${k}']`);
await page.click(".qf:has-text('Protein')");
await shot("4c-quick-add");
console.log("quick add button:", await text(".primary-btn"));
await page.click(".primary-btn"); await settle();
console.log("session bar:", (await text(".session")).replace(/\n/g, " | "));
await page.click(".session .chip.on"); await settle(); // Done
console.log(`Today kcal left: before ${leftBefore} → after salmon + protein bar ${await text(".kcal .t-dxl")}`);

await page.click(".wcard"); await page.waitForTimeout(200); await page.locator(".winput").blur(); await shot("5-weight-entry");
await page.fill(".winput", "82,9"); await page.click(".cbtn[aria-label='Save weight']"); await settle();
console.log("after saving 82,9: today trend", await text(".wcard .t-nm"));

await page.evaluate(() => localStorage.clear());
await go("/progress"); await page.reload(); await settle(); await shot("6-progress");
await page.click(".cell:has-text('14')"); await settle();
console.log("tap 14 Oct →", page.url().split("#")[1], await text(".navlbl"));

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
