// Check sheet for icon B at small sizes -> icons/icon-b-sizes.png.
// Row "master": icon-b.svg rendered at every size (what you'd get with one drawing).
// Row "shipped": the size-specific variant actually used (see scripts/icons.mjs), on dark and light.
// Each size is shown at true pixels (1×) and magnified 3× with nearest-neighbour so mush is visible.
import { chromium } from "playwright-core";
import fs from "node:fs";
const root = new URL("..", import.meta.url).pathname, dir = root + "icons";
const SIZES = [180, 120, 87, 60, 40, 29];
const FAV = [32, 16];
const variantFor = (s) => (s >= 101 ? "icon-b" : s >= 44 ? "icon-b-md" : s >= 24 ? "icon-b-sm" : "icon-b-xs");
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ deviceScaleFactor: 1 });
const uri = {};
async function png(name, s) {
  const k = `${name}@${s}`; if (uri[k]) return uri[k];
  const svg = fs.readFileSync(`${dir}/${name}.svg`, "utf8");
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${s}" height="${s}"`)}</body></html>`);
  return (uri[k] = "data:image/png;base64," + (await p.screenshot({ omitBackground: true })).toString("base64"));
}
const cell = async (name, s, { mask = true } = {}) => {
  const u = await png(name, s), r = mask ? Math.round(s * 0.2237) : 0;
  return `<div class="cell"><div class="pair"><img src="${u}" style="width:${s}px;height:${s}px;border-radius:${r}px">
    <img class="mag" src="${u}" style="width:${s * 3}px;height:${s * 3}px;border-radius:${r * 3}px"></div>
    <div class="lbl">${s} px · ${name.replace("icon-b", "B").replace("B-", "B ") || "B"}</div></div>`;
};
async function row(title, bg, fg, pick, list, opts) {
  let h = `<div class="row" style="background:${bg};color:${fg}"><div class="rt">${title}</div><div class="cells">`;
  for (const s of list) h += await cell(pick(s), s, opts);
  return h + "</div></div>";
}
const tab = async (bg, fg, tabBg) => `<div class="tabs" style="background:${bg}"><div class="tab" style="background:${tabBg};color:${fg}"><img src="${await png("icon-b-xs", 16)}" width="16" height="16"><span>Gym Bro</span><span style="opacity:.5">×</span></div>
  <div class="tab" style="background:${tabBg};color:${fg}"><img src="${await png("icon-b-xs", 32)}" width="16" height="16"><span>Gym Bro (32 px on 2× screens)</span></div></div>`;
let html = `<html><head><style>body{margin:0;font:13px Inter,system-ui,sans-serif;background:#1c1c1f;color:#eee;width:1900px}
h1{font-size:22px;margin:24px 24px 4px} p{margin:0 24px 16px;color:#aaa;max-width:1500px;line-height:1.45}
.row{padding:16px 24px;border-top:1px solid #333}.rt{font-weight:600;margin-bottom:10px}.cells{display:flex;gap:28px;align-items:flex-end;flex-wrap:wrap}
.pair{display:flex;gap:12px;align-items:flex-end}.lbl{margin-top:6px;opacity:.7;font-size:12px}img{image-rendering:pixelated;display:block}
.tabs{display:flex;gap:8px;padding:12px 24px}.tab{display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:8px 8px 0 0}</style></head><body>
<h1>Icon B · small-size check</h1>
<p>Each size at true pixels, then 3× nearest-neighbour. Top two rows: the master drawing at every size. Below: the variant shipped per size.
B = master (≥101 px), B md = 44–100 px (bolder, brighter barbell, inner ring removed), B sm = 24–43 px (barbell dropped, plate 1.4×),
B xs = ≤23 px (plate 1.6×, heavier G, rounded tile). iOS corner mask approximated as 22.4 % radius.</p>`;
html += await row("Master only · dark", "#000", "#fff", () => "icon-b", [...SIZES, ...FAV]);
html += await row("Master only · light", "#f2f2f7", "#111", () => "icon-b", [...SIZES, ...FAV]);
html += await row("Shipped variants · dark (home screen / Spotlight / Settings)", "#000", "#fff", variantFor, SIZES);
html += await row("Shipped variants · light", "#f2f2f7", "#111", variantFor, SIZES);
html += await row("Favicon (favicon.svg = B xs) · dark", "#202124", "#fff", variantFor, FAV, { mask: false });
html += await row("Favicon · light", "#ffffff", "#111", variantFor, FAV, { mask: false });
html += `<div class="row"><div class="rt">Favicon in browser tabs (true size)</div></div>` + (await tab("#202124", "#e8eaed", "#35363a")) + (await tab("#dee1e6", "#202124", "#ffffff"));
html += "</body></html>";
await p.setViewportSize({ width: 1900, height: 800 });
await p.setContent(html);
await p.screenshot({ path: `${dir}/icon-b-sizes.png`, fullPage: true });
await b.close();
console.log("wrote icons/icon-b-sizes.png");
