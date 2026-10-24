// Renders icons/options.png: both icon options on an iOS-like home screen mock (+ small sizes).
import { chromium } from "playwright-core";
import fs from "node:fs";
const dir = new URL("../icons/", import.meta.url).pathname;
const uri = (n) => "data:image/png;base64," + fs.readFileSync(dir + n).toString("base64");
const A = uri("icon-a-180.png"), B = uri("icon-b-180.png");
const font = fs.readFileSync(new URL("../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", import.meta.url)).toString("base64");
const names = ["Calendar", "Camera", "Notes", "Music", "Weather", "Clock", "Maps", "Health", "Files", "Books", "Wallet", null, "Podcasts", "Home", "Stocks", "Settings"];
const tint = ["#2b2b30", "#34343a", "#3b3b42", "#26262b"];
const phone = (icon, label, at) => {
  const cells = names.map((n, i) => i === at
    ? `<div class="app"><img src="${icon}" class="ic me"><span>Gym Bro</span></div>`
    : `<div class="app"><div class="ic" style="background:${tint[i % 4]}"></div><span>${n ?? ""}</span></div>`).join("");
  return `<figure><div class="phone"><div class="sb"><b>9:41</b><i></i></div><div class="grid">${cells}</div>
    <div class="dots"><i class="on"></i><i></i></div>
    <div class="dock">${[0, 1, 2, 3].map((i) => `<div class="ic" style="background:${tint[(i + 1) % 4]}"></div>`).join("")}</div></div>
    <figcaption><b>${label[0]}</b>${label[1]}</figcaption>
    <div class="sizes"><img src="${icon}" style="width:120px;border-radius:27px"><img src="${icon}" style="width:60px;border-radius:13.5px"><img src="${icon}" style="width:40px;border-radius:9px"><img src="${icon}" style="width:29px;border-radius:6.5px"><span>120 · 60 · 40 · 29 pt</span></div></figure>`;
};
const html = `<html><head><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font})}
*{box-sizing:border-box}body{margin:0;background:#141416;font-family:Inter;color:#fff;padding:56px 64px;width:1480px}
h1{font-size:30px;margin:0 0 6px;font-weight:700}p{margin:0 0 36px;color:#a6a6ad;font-size:17px}
.row{display:flex;gap:72px;justify-content:center}figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:22px}
.phone{width:430px;height:900px;border-radius:64px;border:12px solid #2a2a2e;padding:22px 28px;position:relative;
 background:radial-gradient(120% 70% at 20% 10%,#3a4256 0%,#1d2230 45%,#0e0f14 100%);overflow:hidden}
.sb{display:flex;justify-content:space-between;padding:6px 18px 30px;font-size:17px}.sb i{width:70px;height:12px;border-radius:4px;background:#fff;opacity:.85}
.grid{display:grid;grid-template-columns:repeat(4,1fr);row-gap:26px;column-gap:6px}
.app{display:flex;flex-direction:column;align-items:center;gap:7px;font-size:12px;color:#e8e8ee}
.ic{width:72px;height:72px;border-radius:16.2px;display:block}.me{box-shadow:0 0 0 1px rgba(255,255,255,.06)}
.dots{position:absolute;bottom:150px;left:0;right:0;display:flex;justify-content:center;gap:8px}.dots i{width:7px;height:7px;border-radius:4px;background:#ffffff55}.dots i.on{background:#fff}
.dock{position:absolute;left:18px;right:18px;bottom:26px;height:106px;border-radius:36px;background:rgba(255,255,255,.14);display:flex;justify-content:space-around;align-items:center;padding:0 12px}
figcaption{font-size:18px;color:#a6a6ad}figcaption b{color:#fff;margin-right:8px}
.sizes{display:flex;align-items:flex-end;gap:18px;padding:18px 24px;border-radius:20px;background:#ececf0}.sizes span{color:#55555c;font-size:13px;margin-left:6px}
</style></head><body><h1>Gym Bro · home-screen icon options</h1><p>Both on near-black #0B0B0C, full-bleed (iOS applies the rounded mask). Option A is in the manifest for now. Small sizes on a light background check contrast both ways.</p>
<div class="row">${phone(A, ["A", "“GB” bold geometric monogram"], 9)}${phone(B, ["B", "“G” weight plate on a subtle barbell"], 9)}</div></body></html>`;
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1480, height: 1300 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
await p.screenshot({ path: dir + "options.png", fullPage: true });
await b.close();
console.log("icons/options.png");
