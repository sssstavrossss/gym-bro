// Clearly fictional example data ("Demo user"). Not anyone's real numbers.
import { addDays, range, DEMO_TODAY } from "../lib/dates";
import { foodById, macrosFor, type Food } from "./foods";
import type { Entry, SavedGroup, GroupItem } from "../store";
import type { Profile } from "../lib/nutrition";

export const SEED_PROFILE: Profile = {
  goalMode: "rate",
  sex: "male",
  birthYear: 1990,
  heightCm: 180,
  activity: "moderate",
  goal: "lose",
  rate: 0.5,
  goalWeight: 80,
  startWeight: 85.0,
  proteinPerKg: 2.0,
  fatPct: 25,
};

// Morning weigh-ins, 19 Sep – 24 Oct 2026 (fictional). With 10 % smoothing the trend lands on 83.6 kg today
// (the worked example: 2,218 kcal · P167 F62 C249); latest weigh-in 83.3 kg.
const WEIGHTS = [
  85.0, 84.7, 85.1, 84.8, 84.9, 84.6,
  84.8, 84.6, 84.9, 84.4, 84.7, 84.5, 84.2, 84.5, 84.1, 84.3, 84.0, 83.9, 84.1, 84.3, 83.8,
  83.8, 84.0, 84.2, 83.8, 83.6, 84.0, 83.3, 83.8, 83.3, 83.2, 83.1, 83.2, 83.4, 82.9, 83.3,
];
export function seedWeights(): Record<string, number> {
  const out: Record<string, number> = {};
  const first = addDays(DEMO_TODAY, -(WEIGHTS.length - 1));
  WEIGHTS.forEach((w, i) => (out[addDays(first, i)] = w));
  return out;
}

type Line = [string, string, number]; // time, food id, grams
// Today: same foods as the Figma Log (1,746 kcal · P136 F62 C165), now as a timeline.
const TODAY: Line[] = [
  ["07:40", "yogurt", 250], ["07:40", "oats", 60], ["07:41", "blueberries", 100], ["07:42", "pb", 32],
  ["10:15", "almonds", 30],
  ["12:30", "chicken", 180], ["12:30", "rice", 200], ["12:31", "avocado", 50], ["12:31", "oil", 10],
  ["15:45", "whey", 30], ["15:46", "banana", 120],
];
// Typical full days, scaled to a given calorie level for past days.
const DAY_TEMPLATES: Line[][] = [
  [...TODAY, ["18:50", "salmon", 150], ["18:50", "sweetpotato", 200], ["18:51", "broccoli", 150]],
  [
    ["08:05", "eggs", 150], ["08:05", "bread", 80], ["08:06", "avocado", 50],
    ["12:10", "tuna", 120], ["12:10", "pasta", 220], ["12:11", "oil", 10],
    ["15:30", "apple", 180],
    ["19:05", "beef5", 150], ["19:05", "rice", 200], ["19:06", "broccoli", 150],
    ["21:40", "cottage", 200], ["21:40", "whey", 30],
  ],
  [
    ["07:20", "oats", 70], ["07:20", "milk", 250], ["07:21", "banana", 120], ["07:21", "whey", 30],
    ["12:45", "chicken", 180], ["12:45", "sweetpotato", 250], ["12:46", "feta", 40],
    ["16:00", "yogurt", 200], ["16:00", "honey", 20], ["16:01", "almonds", 30],
    ["19:30", "tofu", 200], ["19:30", "rice", 200], ["19:31", "oil", 10],
  ],
];

// % off the calorie target for 1–23 Oct (from the Figma calendar). null = nothing logged.
const OCT_DEV: (number | null)[] = [3, -8, 2, 15, 4, -1, null, 6, 3, 12, -2, 5, 4, 30, -7, 2, 9, 3, -18, 4, 1, 6, -3];
const SEP_DEV: (number | null)[] = [5, -4, 12, 2, -6, 8, 1, -3, 22, 4, -9, 3, 0, 6, null, -2, 7, 14, -5, 2, 9, -1, 3, -12, 5, 1, 16, -4, 2, 7];

let n = 0;
const id = () => `e${++n}`;

function line(date: string, [time, foodId, grams]: Line): Entry {
  const food = foodById(foodId)!;
  // log in the food's usual unit when the amount fits it exactly (2 eggs = 2 pieces), else grams
  const sv = food.servings?.find((x) => x.name === food.usualUnit);
  const [amount, unit] = sv && grams % sv.g === 0 ? [grams / sv.g, sv.name] : food.usualUnit === "ml" ? [grams, "ml"] : [grams, "g"];
  return { id: id(), date, time, foodId, name: food.name, grams, amount, unit, per100: { kcal: food.kcal, p: food.p, f: food.f, c: food.c }, ...macrosFor(food, grams) };
}

/** Past days are scaled to that day's own target (from target history). Logging starts 15 Sep; the
 *  first target is 19 Sep, so 15–18 Sep show "no target". */
export function seedEntries(targetOn: (date: string) => number): Entry[] {
  const out: Entry[] = [];
  const days = range("2026-09-15", addDays(DEMO_TODAY, -1));
  days.forEach((date, i) => {
    const d = Number(date.slice(8, 10));
    const dev = date.startsWith("2026-10") ? OCT_DEV[d - 1] : SEP_DEV[d - 1];
    if (dev === null || dev === undefined) return;
    const tpl = DAY_TEMPLATES[i % DAY_TEMPLATES.length];
    const base = tpl.reduce((s, l) => s + macrosFor(foodById(l[1])!, l[2]).kcal, 0);
    const k = (targetOn(date) * (1 + dev / 100)) / base;
    for (const l of tpl) out.push(line(date, [l[0], l[1], Math.max(5, Math.round((l[2] * k) / 5) * 5)]));
  });
  for (const l of TODAY) out.push(line(DEMO_TODAY, l));
  return out;
}

function item(foodId: string, grams: number): GroupItem {
  const f = foodById(foodId)!;
  const sv = f.servings?.find((x) => x.name === f.usualUnit);
  const [amount, unit] = sv && grams % sv.g === 0 ? [grams / sv.g, sv.name] : f.usualUnit === "ml" ? [grams, "ml"] : [grams, "g"];
  return { foodId, name: f.name, grams, amount, unit, per100: { kcal: f.kcal, p: f.p, f: f.f, c: f.c }, ...macrosFor(f, grams) };
}
export function seedGroups(): SavedGroup[] {
  return [
    { id: "g1", name: "Usual breakfast", items: [item("yogurt", 250), item("oats", 60), item("blueberries", 100), item("pb", 32)] },
    { id: "g2", name: "Post-gym shake", items: [item("whey", 30), item("banana", 120), item("milk", 250)] },
    { id: "g3", name: "Chicken & rice", items: [item("chicken", 180), item("rice", 200), item("oil", 10)] },
  ];
}

/** Fictional custom foods (S3). Duplicate names are allowed — the brand tells them apart. */
export function seedMyFoods(): Food[] {
  return [
    { id: "my-soup", name: "Lentil soup, home-made", kcal: 72, p: 4.8, f: 1.6, c: 9.6, usual: 330, servings: [{ name: "serving", g: 330 }], usualUnit: "serving", usualAmount: 1, mine: true },
    { id: "my-bar1", name: "Protein bar, cookie", brand: "Northbar", barcode: "2000000012345", kcal: 380, p: 33, f: 12, c: 35, usual: 60, servings: [{ name: "bar", g: 60 }], usualUnit: "bar", usualAmount: 1, mine: true },
    { id: "my-bar2", name: "Protein bar, cookie", brand: "Fitbake", kcal: 352, p: 30, f: 11, c: 33, usual: 55, servings: [{ name: "bar", g: 55 }], usualUnit: "bar", usualAmount: 1, mine: true },
  ];
}
