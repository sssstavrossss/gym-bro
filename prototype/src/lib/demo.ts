// Hidden reviewer switch: Profile → Demo states, or ?demo=<state> in the URL.
import { emptyAccount, freshStartDemo, lowAccuracyDemo, zeroIn7Demo, manualDemo, resetDemo, startOnboarding, today } from "../store";
import { endSelect, ui, type DemoState } from "../ui";

export const DEMO_STATES: { key: DemoState; label: string; hint: string }[] = [
  { key: "normal", label: "Normal", hint: "example data (fictional)" },
  { key: "onboarding", label: "First run", hint: "no profile yet → setup" },
  { key: "empty", label: "Empty account", hint: "profile set, nothing logged, only the setup weigh-in" },
  { key: "lowacc", label: "Low accuracy", hint: "1 weigh-in in the last 7 days → trend with the grey dot" },
  { key: "fresh", label: "Fresh start", hint: "6 weeks without a weigh-in, then 82.4 kg today → recalculate?" },
  { key: "only", label: "Only weigh-in", hint: "one weigh-in → weight sheet: can't be deleted, Edit; chart centred on 85.0" },
  { key: "zero7", label: "No weigh-ins in 7 days", hint: "last weigh-in 9 days ago → dot sheet, trend held where it was then" },
  { key: "datewin", label: "Weigh-in day list", hint: "weight sheet with the day list open: today … today − 7 (8 days)" },
  { key: "typo", label: "Typo guard", hint: "weight sheet with 38.6 kg typed → “Is 38.6 kg right?”" },
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
  ui.weightDraft = null;
  ui.weightPicker = false;
  if (s === "onboarding") startOnboarding();
  else if (s === "empty") emptyAccount();
  else if (s === "lowacc") lowAccuracyDemo();
  else if (s === "fresh") freshStartDemo();
  else if (s === "only") { emptyAccount(); ui.weightDate = today; ui.sheet = "weight"; }
  else if (s === "zero7") { zeroIn7Demo(); ui.sheet = "accuracy"; ui.accReturn = null; }
  else if (s === "datewin") { resetDemo(); ui.weightDate = today; ui.sheet = "weight"; ui.weightPicker = true; }
  else if (s === "typo") { resetDemo(); ui.weightDraft = "38.6"; ui.weightDate = today; ui.sheet = "weight"; }
  else if (s === "manual") manualDemo();
  else if (s === "goalreached") manualDemo(true);
  else resetDemo();
  ui.demo = s;
}
export const isDemoState = (s: string | null): s is DemoState => !!s && DEMO_STATES.some((d) => d.key === s);
