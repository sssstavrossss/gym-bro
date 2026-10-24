import { createRouter, createWebHashHistory } from "vue-router";
import TodayView from "./views/TodayView.vue";
import LogView from "./views/LogView.vue";
import ProgressView from "./views/ProgressView.vue";
import ProfileView from "./views/ProfileView.vue";

// Hash history: works from any sub-path, from a static host, and from file:// (single-file build).
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/today" },
    { path: "/today", component: TodayView },
    { path: "/log/:date?", component: LogView },
    { path: "/progress/:month?", component: ProgressView },
    { path: "/profile", component: ProfileView },
    { path: "/:pathMatch(.*)*", redirect: "/today" },
  ],
});
