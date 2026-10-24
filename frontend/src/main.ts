import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { routes } from "./router";
import "./styles/main.css";

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

createApp(App).use(router).mount("#app");
