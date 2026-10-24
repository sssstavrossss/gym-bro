// Dynamic Type check (decision 33). Simulates the iOS text size by setting the root/body size with ?dt=N
// (on a real iPhone the root comes from -apple-system-body), at 393×852, and checks every screen for:
//   clipped / off-screen text, ellipsis-truncated text (esp. numbers), overlapping text, and touch targets < 44 pt.
// Sizes: 17 px (default "Large"), 23 px (xxxLarge, largest standard), 34 px (2×), 53 px (AX5, largest Larger Text).
// ENGINE=webkit uses Playwright WebKit with iPhone 15 emulation (needs a WebKit build: PWC=/path/to/playwright-core).
// Output: shots/dynamic-type/*.png, grid-*.png (via compare.py) and a11y/dynamic-type.md.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const engine = process.env.ENGINE || "chromium";
const pw = await import(process.env.PWC ? pathToFileURL(path.join(process.env.PWC, "index.mjs")).href : "playwright-core");
const root = path.resolve(import.meta.dirname, "..");
const base = pathToFileURL(path.join(root, "gymbro-prototype.html")).href;
const outDir = path.join(root, "shots", "dynamic-type"); fs.mkdirSync(outDir, { recursive: true });
const SIZES = [[17, "default"], [23, "xxxL"], [34, "2x"], [53, "AX5"]];
const browser = engine === "webkit" ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctxOpts = engine === "webkit" ? { ...pw.devices["iPhone 15"], viewport: { width: 393, height: 852 } } : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
let seq = 0;
const settle = (ms = 450) => page.waitForTimeout(ms);
const go = async (hash, dt, demo = "normal") => { await page.goto(`${base}?statusbar&now=17:20&demo=${demo}&dt=${dt}&s=${++seq}#${hash}`); await page.evaluate(() => document.fonts.ready); await settle(); };
const openAdd = async () => { await page.click(".tabbar .plus"); await page.click(".tile:has-text('Food')"); await settle(); };
const SCREENS = [
  ["today", "/today"], ["log", "/log"],
  ["food-sheet", "/today", openAdd],
  ["food-detail", "/today", async () => { await openAdd(); await page.locator(".rrow:not(.grp):has-text('Eggs') .rtext").first().click(); await settle(); }],
  ["weight", "/today", async () => { await page.locator(".wcard .stretch").click(); await settle(); await page.locator(".winput").blur(); }],
  ["progress", "/progress"], ["profile", "/profile"],
  ["s8-lowacc-today", "/today", null, "lowacc"],
  ["s8-accuracy-sheet", "/today", async () => { await page.locator(".wcard .accdot").click(); await settle(); }, "lowacc"],
  ["s8-fresh-today", "/today", null, "fresh"],
  ["s8-typo-guard", "/today", null, "typo"],
  ["d35-only-weigh-in", "/today", null, "only"],
  ["d35-zero-in-7", "/today", null, "zero7"],
  ["d35-day-list", "/today", null, "datewin"],
  ["onboarding-1", "/today", null, "onboarding"],
  ["onboarding-2", "/today", async () => { await page.locator("form .primary-btn").last().click(); await settle(); }, "onboarding"],
];
// In-page audit. Returns problems; scroll containers are only checked horizontally.
const audit = () => page.evaluate(() => {
  const vw = innerWidth, out = { clipped: [], ellipsis: [], overlap: [], small: [], nameEll: [] };
  const chrome = ".demo-pill, .home-ind, .status-bg, .toast";
  // only audit the top layer: an open sheet / dialog / full-screen state hides the screen underneath
  const layers = [...document.querySelectorAll(".ob, .sheet-root, .chooser-root, .down, .menu")]; const layer = layers[layers.length - 1] || document.body;
  const visible = (e) => { const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false; if (e.closest(".sr-only, [aria-hidden='true'] .sr-only")) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const hidden = (e) => { for (let a = e; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return true; } return false; };
  const desc = (e) => `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).trim().replace(/\s+/g, ".")} "${(e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
  const texts = [...layer.querySelectorAll("*")].filter((e) => !e.closest("svg") && !e.closest(".sr-only") && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && visible(e) && !hidden(e));
  for (const e of texts) {
    const r = e.getBoundingClientRect();
    if (e.closest(chrome)) continue;
    // clipped by an ancestor with overflow hidden/clip (or off-screen horizontally)
    if (r.right > vw + 1 || r.left < -1) { out.clipped.push(desc(e) + ` x ${Math.round(r.left)}–${Math.round(r.right)}`); continue; }
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a); if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = a.getBoundingClientRect();
      const hx = cs.overflowX !== "visible", hy = cs.overflowY === "hidden" || cs.overflowY === "clip";
      if ((hx && (r.right > c.right + 1 || r.left < c.left - 1)) || (hy && (r.bottom > c.bottom + 1 || r.top < c.top - 1))) { out.clipped.push(desc(e) + " clipped by " + desc(a).slice(0, 40)); }
      break;
    }
    const cs = getComputedStyle(e);
    if (cs.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1) (/\d[\d,.]*\s*(kcal|g\b|ml\b|kg\b)|\b[PFC]\d/.test(e.textContent) ? out.ellipsis : out.nameEll).push(desc(e));
  }
  // overlapping text (leaf text boxes from different elements, using text-node ranges)
  const boxes = [];
  for (const e of texts) { if (e.closest(chrome) || e.closest(".tabbar")) continue; for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); for (const b of rg.getClientRects()) if (b.width > 1) boxes.push({ e, b }); } }
  const seen = new Set();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j]; if (A.e === B.e || A.e.contains(B.e) || B.e.contains(A.e)) continue;
    const ox = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left), oy = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
    if (ox > 2 && oy > Math.max(3, 0.3 * Math.min(A.b.height, B.b.height))) { const k = desc(A.e) + " ↔ " + desc(B.e); if (!seen.has(k)) { seen.add(k); out.overlap.push(k); } }
  }
  // touch targets (button/link/input/role=button|radio|tab), counting an absolutely positioned ::after/::before hit area
  for (const e of layer.querySelectorAll("button, a[href], input:not([type=hidden]), select, [role=button], [role=radio], [role=tab], [role=checkbox], label.qsave")) {
    if (e.disabled || e.closest(chrome)) continue;
    let t = e; const inv = +getComputedStyle(e).opacity === 0 && e.parentElement; if (inv) t = e.parentElement; // invisible native input laid over a chip
    if (hidden(t) || !visible(t)) continue;
    const r = t.getBoundingClientRect(); let w = r.width, h = r.height;
    if (inv) { const ir = e.getBoundingClientRect(); w = Math.max(w, ir.width); h = Math.max(h, ir.height); }
    { const lb = t.tagName === 'INPUT' && t.closest('label'); if (lb) { const lr = lb.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); } }
    { const f = t.closest('.field'); if (f && t.tagName === 'INPUT') { const fr = f.getBoundingClientRect(); w = Math.max(w, fr.width); h = Math.max(h, fr.height); } }
    for (const ps of ["::after", "::before"]) { const s = getComputedStyle(t, ps); if (s.content === "none" || s.position !== "absolute") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : 0);
      if (s.left !== "auto" && s.right !== "auto") w = Math.max(w, r.width - px(s.left) - px(s.right)); else w = Math.max(w, parseFloat(s.width) || 0);
      if (s.top !== "auto" && s.bottom !== "auto") h = Math.max(h, r.height - px(s.top) - px(s.bottom)); else h = Math.max(h, parseFloat(s.height) || 0); }
    if (w < 43.5 || h < 43.5) out.small.push(desc(t).slice(0, 70) + ` ${Math.round(w)}×${Math.round(h)}`);
  }
  out.root = getComputedStyle(document.documentElement).fontSize;
  return out;
});
const report = [`# Dynamic Type check — ${engine}${engine === "webkit" ? " (Playwright WebKit, iPhone 15 emulation)" : " (Chrome)"} · 393×852\n`,
  "Text size simulated with `?dt=N` (root font-size). Clipped = text cut off by an overflow-hidden ancestor or off-screen; Ellipsis = text-overflow truncation; Overlap = two text runs drawn on top of each other; Small = touch target under 44×44 pt (incl. ::after hit areas).\n"];
const totals = {};
for (const [name, hash, act, demo] of SCREENS) {
  report.push(`\n## ${name}`);
  for (const [dt, label] of SIZES) {
    await go(hash, dt, demo); if (act) await act();
    const a = await audit();
    const tag = `${name}-${String(SIZES.findIndex((s) => s[0] === dt) + 1)}-${label}`;
    if (engine === "chromium") await page.screenshot({ path: path.join(outDir, `${tag}.png`) });
    else await page.screenshot({ path: path.join(outDir, `webkit-${tag}.png`) });
    // second shot scrolled to the bottom of the scrolling area (shows the last rows clear of the tab bar)
    const scrolled = await page.evaluate(() => { const layers = [...document.querySelectorAll(".ob, .sheet-root, .chooser-root, .down, .menu")]; const L = layers[layers.length - 1] || document.body;
      const sc = [...L.querySelectorAll("*")].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 40; }).sort((x, y) => (y.scrollHeight - y.clientHeight) - (x.scrollHeight - x.clientHeight))[0];
      if (!sc) return false; sc.scrollTop = sc.scrollHeight; return true; });
    if (scrolled && dt >= 23) { await settle(250); await page.screenshot({ path: path.join(outDir, `${engine === "webkit" ? "webkit-" : ""}${tag}-end.png`) }); }
    const n = a.clipped.length + a.ellipsis.length + a.overlap.length;
    totals[label] = (totals[label] || 0) + n + (dt === 53 ? a.small.length : 0);
    report.push(`- **${label} (${dt} px, root ${a.root})**: ${n ? "" : "no clipping, ellipsis or overlap"}${a.clipped.length ? `\n  - clipped: ${a.clipped.slice(0, 6).join("; ")}` : ""}${a.ellipsis.length ? `\n  - ellipsis (contains a number): ${a.ellipsis.slice(0, 6).join("; ")}` : ""}${a.nameEll.length ? `\n  - note: ${a.nameEll.length} name-only text(s) shortened with … (by design at default size; wrap from xxLarge)` : ""}${a.overlap.length ? `\n  - overlap: ${a.overlap.slice(0, 6).join("; ")}` : ""}${dt >= 34 ? (a.small.length ? `\n  - targets < 44 pt: ${a.small.slice(0, 8).join("; ")}` : "\n  - all touch targets ≥ 44 pt") : ""}`);
  }
}
// Live change (decision 33.2): text size changes while the app is in the background → on return the layout classes follow.
await go("/today", 17); await page.evaluate(() => { document.documentElement.classList.remove("dt-sim"); document.documentElement.style.fontSize = "53px"; Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await settle(200);
const live = await page.evaluate(() => ({ xl: document.documentElement.classList.contains("dt-xl"), root: getComputedStyle(document.documentElement).fontSize }));
report.push(`\n## Live text-size change\nRoot changed 17 → ${live.root} without reload, then visibilitychange: AX layout classes ${live.xl ? "applied ✓" : "NOT applied ✗"} (CSS rem sizes follow immediately).`);
report.push(`\n## Totals (issues per size; AX5 includes small targets)\n${Object.entries(totals).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
report.push(errors.length ? `\nPage errors: ${errors.join("; ")}` : "\nNo page errors.");
fs.writeFileSync(path.join(root, "a11y", engine === "webkit" ? "dynamic-type-webkit.md" : "dynamic-type.md"), report.join("\n") + "\n");
console.log(report.join("\n"));
await browser.close();
