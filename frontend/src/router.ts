import PlaceholderView from "./views/PlaceholderView.vue";
import ProfileView from "./views/ProfileView.vue";
import SetupView from "./views/SetupView.vue";
import TodayView from "./views/TodayView.vue";

export const routes = [
  { path: "/", redirect: "/today" },
  { path: "/today", component: TodayView },
  {
    path: "/log",
    component: PlaceholderView,
    meta: {
      title: "Log",
      body: "The food log arrives in a later update.",
    },
  },
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
