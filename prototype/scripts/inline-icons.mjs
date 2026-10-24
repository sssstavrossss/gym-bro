// Single-file build: inline the favicon and apple-touch-icon as data URIs (vite-plugin-singlefile only inlines JS/CSS).
import fs from "node:fs";
const f = new URL("../gymbro-prototype.html", import.meta.url);
const a = (p) => fs.readFileSync(new URL("../src/assets/" + p, import.meta.url));
let h = fs.readFileSync(f, "utf8");
h = h.replace(/(rel="icon" type="image\/svg\+xml" href=")[^"]+/, `$1data:image/svg+xml;base64,${a("favicon.svg").toString("base64")}`);
h = h.replace(/(rel="apple-touch-icon" href=")[^"]+/, `$1data:image/png;base64,${a("apple-touch-icon.png").toString("base64")}`);
fs.writeFileSync(f, h);
