// Hidden reviewer switch: Profile → Demo states, or ?demo=<state> in the URL.
import { emptyAccount, manualDemo, resetDemo, sparseWeighIns, startOnboarding } from "../store";
import { endSelect, ui, type DemoState } from "../ui";

export const DEMO_STATES: { key: DemoState; label: string; hint: string }[] = [
  { key: "normal", label: "Normal", hint: "example data (fictional)" },
  { key: "onboarding", label: "First run", hint: "no profile yet → setup" },
  { key: "empty", label: "Empty account", hint: "profile set, nothing logged, no weigh-ins" },
  { key: "sparse", label: "Trend not ready", hint: "only 2 weigh-ins in the last 7 days" },
  { key: "manual", label: "Own calorie number", hint: "goal mode “My own number”, 2,000 kcal since Thu 22 Oct" },
  { key: "goalreached", label: "Goal reached", hint: "own number, trend has reached the goal weight → question" },
  { key: "loading", label: "Loading", hint: "skeletons for day data and search" },
  { key: "offline", label: "Food search failing", hint: "outside food database down; local results + retry" },
  { key: "unreachable", label: "Server unreachable · saving", hint: "saving fails, entry kept (Mac asleep)" },
  { key: "down", label: "Server unreachable · full screen", hint: "app can't reach the server (also shown when offline)" },
];

export function applyDemo(s: DemoState) {
  endSelect();
  ui.sheet = null;
  if (s === "onboarding") startOnboarding();
  else if (s === "empty") emptyAccount();
  else if (s === "sparse") sparseWeighIns();
  else if (s === "manual") manualDemo();
  else if (s === "goalreached") manualDemo(true);
  else resetDemo();
  ui.demo = s;
}
export const isDemoState = (s: string | null): s is DemoState => !!s && DEMO_STATES.some((d) => d.key === s);
