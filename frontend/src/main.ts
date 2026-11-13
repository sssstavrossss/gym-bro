import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { vAutofocus } from "./lib/autofocus";
import { routes } from "./router";
import { applyTheme, readTheme } from "./lib/theme";
import "./styles/main.css";

applyTheme(readTheme());

const router = createRouter({
  history: createWebHistory(),
  routes,
});

function dynamicType() {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 17;
  document.documentElement.classList.toggle("dt-l", px >= 22);
  document.documentElement.classList.toggle("dt-xl", px >= 28);
}
dynamicType();
window.addEventListener("resize", dynamicType);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

createApp(App).directive("autofocus", vAutofocus).use(router).mount("#app");
