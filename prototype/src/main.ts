import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles/main.css";

// ?statusbar draws a fake iPhone status bar + home-indicator inset (used for the phone screenshots).
if (new URLSearchParams(location.search).has("statusbar")) document.documentElement.classList.add("demo-statusbar");
// ?dt=23 simulates an iOS text size (root/body px) — prototype only; on a real iPhone the root follows -apple-system-body.
{ const dt = Number(new URLSearchParams(location.search).get("dt")); if (dt >= 10 && dt <= 80) { document.documentElement.style.setProperty("--dt-sim", dt + "px"); document.documentElement.classList.add("dt-sim"); } }
// Dynamic Type: CSS picks up a new text size on its own; nudge anything that measures layout in JS when the app comes back.
// Size classes for layouts that must reflow (not just grow) at large text: dt-l ≥ 22 px body (xxLarge+), dt-xl ≥ 28 px (AX1+).
const dtClasses = () => {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 17;
  document.documentElement.classList.toggle("dt-l", px >= 22);
  document.documentElement.classList.toggle("dt-xl", px >= 28);
};
dtClasses();
window.addEventListener("resize", dtClasses);
window.addEventListener("pageshow", dtClasses);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { dtClasses(); window.dispatchEvent(new Event("resize")); } });

createApp(App).use(router).mount("#app");

// S4: network-first service worker for the app shell. Only when served over https or localhost from the
// regular build (not the single-file prototype, not the dev server).
if ("serviceWorker" in navigator && import.meta.env.PROD && import.meta.env.MODE !== "single" &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
