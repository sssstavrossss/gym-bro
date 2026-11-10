import LogView from "./views/LogView.vue";
import ProfileView from "./views/ProfileView.vue";
import ProgressView from "./views/ProgressView.vue";
import SetupView from "./views/SetupView.vue";
import TodayView from "./views/TodayView.vue";

export const routes = [
  { path: "/", redirect: "/today" },
  { path: "/today", component: TodayView },
  { path: "/log", component: LogView },
  { path: "/log/:date", component: LogView },
  { path: "/progress", component: ProgressView },
  { path: "/profile", component: ProfileView },
  { path: "/setup", component: SetupView },
];
