// Render app icons from the SVG masters. Icon B (chosen 24 Oct 2026) has size-specific variants:
//   icon-b.svg     ≥101 px (1024/512/192/180/120) — master
//   icon-b-md.svg  44–100 px (87, 60)  — bolder/brighter barbell, no faint inner ring
//   icon-b-sm.svg  24–43 px (40, 32, 29) — barbell dropped, plate 1.4×
//   icon-b-xs.svg  ≤23 px (16 favicon)   — plate 1.6×, heavier G, rounded tile
// Then copies the production assets (manifest PNGs, apple-touch-icon, favicon.svg).
import { chromium } from "playwright-core";
import fs from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const dir = root + "icons";
export const variantFor = (s) => (s >= 101 ? "icon-b" : s >= 44 ? "icon-b-md" : s >= 24 ? "icon-b-sm" : "icon-b-xs");
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage();
async function render(name, s, out) {
  const svg = fs.readFileSync(`${dir}/${name}.svg`, "utf8");
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${s}" height="${s}"`)}</body></html>`);
  await p.screenshot({ path: out, omitBackground: true });
}
for (const n of ["icon-a"]) for (const s of [1024, 512, 192, 180]) await render(n, s, `${dir}/${n}-${s}.png`);
await render("icon-a-maskable", 512, `${dir}/icon-a-maskable-512.png`);
for (const s of [1024, 512, 192, 180, 120, 87, 60, 40, 32, 29, 16]) await render(variantFor(s), s, `${dir}/icon-b-${s}.png`);
await render("icon-b-maskable", 512, `${dir}/icon-b-maskable-512.png`);
await b.close();
// production assets: icon B
fs.rmSync(root + "public/icons", { recursive: true, force: true }); fs.mkdirSync(root + "public/icons");
for (const f of ["icon-b-192.png", "icon-b-512.png", "icon-b-maskable-512.png"]) fs.copyFileSync(`${dir}/${f}`, `${root}public/icons/${f}`);
fs.copyFileSync(`${dir}/icon-b-180.png`, root + "src/assets/apple-touch-icon.png");
fs.copyFileSync(`${dir}/icon-b-xs.svg`, root + "src/assets/favicon.svg");
console.log("icons ok");
