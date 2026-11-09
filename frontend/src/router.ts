import PlaceholderView from "./views/PlaceholderView.vue";
import LogView from "./views/LogView.vue";
import ProfileView from "./views/ProfileView.vue";
import SetupView from "./views/SetupView.vue";
import TodayView from "./views/TodayView.vue";

export const routes = [
  { path: "/", redirect: "/today" },
  { path: "/today", component: TodayView },
  { path: "/log", component: LogView },
  { path: "/log/:date", component: LogView },
  {
    path: "/progress",
    component: PlaceholderView,
    meta: {
      title: "Progress",
      body: "Progress arrives in a later update.",
    },
  },
  { path: "/profile", component: ProfileView },
  { path: "/setup", component: SetupView },
];
