// S5: axe-core (WCAG 2.x A/AA rules) on every main screen and sheet, phone + desktop; 200 % text check
// (root font-size 32 px: no horizontal page overflow, screenshots in shots/a11y); reduced-motion check.
// Usage: node scripts/a11y.mjs   (after npm run build). Writes a11y/axe.md.
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const url = pathToFileURL(path.join(root, "gymbro-prototype.html")).href;
const axeSrc = fs.readFileSync(path.join(root, "node_modules/axe-core/axe.min.js"), "utf8");
fs.mkdirSync(path.join(root, "shots/a11y"), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const report = [];
const fails = [];

async function run(label, ctxOpts, steps) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  let i = 0;
  for (const [name, hash, act] of steps) {
    await page.goto(url + `?now=17:20&s=${++i}#` + hash); // new query = real reload (hash-only goto keeps state) await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
    if (act) { await act(page); await page.waitForTimeout(350); }
    await page.addScriptTag({ content: axeSrc });
    const res = await page.evaluate(async () => {
      // @ts-ignore
      const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, t: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
    });
    report.push(`- **${label} · ${name}**: ${res.length ? res.map((v) => `${v.id} (${v.impact}, ${v.n}) — ${v.help} — ${v.t.join(" | ")}`).join("; ") : "no violations"}`);
    if (res.length) fails.push(`${label} ${name}`);
    console.log(label, name, res.length ? JSON.stringify(res) : "ok");
  }
  await ctx.close();
}
const phone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: "Europe/Oslo" };
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: "Europe/Oslo" };
const openAdd = async (p) => { await p.keyboard.press("n"); await p.waitForTimeout(250); if (!(await p.locator(".sheet-root").count())) { await p.click(".tabbar .plus"); await p.click(".tile:has-text('Food')"); } await p.waitForTimeout(300); };
const steps = [
  ["Today", "/today"], ["Log", "/log"], ["Progress", "/progress"], ["Profile", "/profile"],
  ["Add food · search", "/today", openAdd],
  ["Food detail · units", "/today", async (p) => { await openAdd(p); await p.click(".rrow:not(.grp):has-text('Eggs') .rtext"); }],
  ["Custom serving form", "/today", async (p) => { await openAdd(p); await p.click(".rrow:not(.grp):has-text('Eggs') .rtext"); await p.click(".uchip.add"); }],
  ["My foods", "/today", async (p) => { await openAdd(p); await p.click("button:has-text('My foods')"); }],
  ["New food form", "/today", async (p) => { await openAdd(p); await p.click("button:has-text('New food')"); }],
  ["Quick Add", "/today", async (p) => { await openAdd(p); await p.click(".seg-btn:has-text('Quick Add')"); }],
  ["Edit entry", "/log", async (p) => { await p.locator(".frow").first().click(); }],
  ["Weight sheet", "/today", async (p) => { await p.keyboard.press("w").catch(() => {}); if (!(await p.locator(".sheet-root").count())) await p.locator(".wcard .stretch, .wbig .stretch").first().click(); }],
  // S8 Part A
  ["S8 low accuracy · Today", "/today", async (p) => { await p.goto(url + "?demo=lowacc&now=17:20&s8=1#/today"); await p.waitForTimeout(300); }],
  ["S8 accuracy sheet", "/today", async (p) => { await p.goto(url + "?demo=lowacc&now=17:20&s8=2#/today"); await p.waitForTimeout(300); await p.locator(".wcard .accdot, .wbig .accdot").first().click(); }],
  ["S8 fresh start · Today", "/today", async (p) => { await p.goto(url + "?demo=fresh&now=17:20&s8=3#/today"); await p.waitForTimeout(300); }],
  ["S8 fresh start · Weight sheet", "/today", async (p) => { await p.goto(url + "?demo=fresh&now=17:20&s8=4#/today"); await p.waitForTimeout(300); await p.locator(".wcard .stretch, .wbig .stretch").first().click(); }],
  ["S8 typo guard", "/today", async (p) => { await p.goto(url + "?demo=typo&now=17:20&s8=5#/today"); await p.waitForTimeout(300); }],
  ["S8 low accuracy · Profile", "/profile", async (p) => { await p.goto(url + "?demo=lowacc&now=17:20&s8=6#/profile"); await p.waitForTimeout(300); }],
  // decision 35
  ["D35 only weigh-in sheet", "/today", async (p) => { await p.goto(url + "?demo=only&now=17:20&d35=1#/today"); await p.waitForTimeout(400); }],
  ["D35 0 weigh-ins in 7 days sheet", "/today", async (p) => { await p.goto(url + "?demo=zero7&now=17:20&d35=2#/today"); await p.waitForTimeout(400); }],
  ["D35 day list (8 days)", "/today", async (p) => { await p.goto(url + "?demo=datewin&now=17:20&d35=3#/today"); await p.waitForTimeout(400); }],
  ["Server unreachable", "/today?demo=down"],
];
await run("Phone", phone, steps.map(([a, b, c]) => [a, b.includes("?") ? b : b, c]).map(([a, b, c]) => (b.includes("?demo") ? [a, "/today", async (p) => { await p.goto(url + "?demo=down&now=17:20#/today"); await p.waitForTimeout(300); }] : [a, b, c])));
await run("Desktop", desk, steps.map(([a, b, c]) => (b.includes("?demo") ? [a, "/today", async (p) => { await p.goto(url + "?demo=down&now=17:20#/today"); await p.waitForTimeout(300); }] : [a, b, c])));

// 200 % text: root font-size 32 px (rem-based type), phone + desktop
const big = [];
for (const [label, opts] of [["phone", phone], ["desktop", desk]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  for (const hash of ["/today", "/log", "/progress", "/profile"]) {
    await page.goto(url + `?now=17:20&h=${hash.slice(1)}#` + hash); await page.addStyleTag({ content: "html{font-size:32px}" }); await page.waitForTimeout(350);
    const o = await page.evaluate(() => {
      const sc = document.querySelector(".scroller") || document.documentElement;
      const over = [...document.querySelectorAll(".screen *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1); }).slice(0, 5).map((el) => el.className.toString().slice(0, 40));
      return { pageOverflow: sc.scrollWidth > sc.clientWidth + 1, over };
    });
    big.push(`- ${label} ${hash}: ${o.pageOverflow || o.over.length ? `overflow (${o.over.join(", ")})` : "no horizontal overflow"}`);
    await page.screenshot({ path: path.join(root, `shots/a11y/text200-${label}-${hash.slice(1)}.png`), fullPage: false });
  }
  await ctx.close();
}
// reduced motion
const ctx = await browser.newContext({ ...phone, reducedMotion: "reduce" });
const pg = await ctx.newPage();
await pg.goto(url + "#/today"); await pg.waitForTimeout(300);
const rm = await pg.evaluate(() => getComputedStyle(document.querySelector(".cbtn, .primary-btn, button")).transitionDuration);
await ctx.close();
await browser.close();
const md = `# Accessibility checks

Generated by \`node scripts/a11y.mjs\`. axe-core ${JSON.parse(fs.readFileSync(path.join(root, "node_modules/axe-core/package.json"), "utf8")).version}, tags wcag2a/2aa/21a/21aa/22aa.

## axe
${report.join("\n")}

## 200 % text (root font-size 32 px)
${big.join("\n")}

Screenshots: shots/a11y/text200-*.png

## Reduced motion
Transition duration with prefers-reduced-motion: reduce → \`${rm}\`

## Contrast
See contrast.md (\`node scripts/contrast.mjs\`).
`;
fs.writeFileSync(path.join(root, "a11y/axe.md"), md);
console.log(md);
if (fails.length) process.exitCode = 1;
