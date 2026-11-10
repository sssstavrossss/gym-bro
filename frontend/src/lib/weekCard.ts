import { macroStatus } from "./macros";

export interface MacroTotals {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface DayTarget {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * One day on the desktop This week card.
 * On target is decision 7 against that day's own target: kcal ±5 %, protein at or above,
 * fat and carbs ±10 %. Over is kcal past the ±5 % band, and it never carries a tick.
 */
export interface WeekJudgement {
  future: boolean;
  logged: boolean;
  targetKcal: number | null;
  on: boolean;
  over: boolean;
  /** Calories as a share of 120 % of that day's target, so the target line sits at 1/1.2. */
  bar: number | null;
}

export function judgeWeekDay(input: {
  date: string;
  today: string;
  logged: boolean;
  eaten: MacroTotals | null;
  target: DayTarget | null;
}): WeekJudgement {
  const future = input.date > input.today;
  const logged = !future && input.logged;
  const target = future ? null : input.target;
  const eaten = logged ? input.eaten : null;
  const targetKcal = target?.kcal ?? null;
  if (!logged || !target || !eaten) {
    return { future, logged, targetKcal, on: false, over: false, bar: null };
  }
  const kcal = macroStatus("kcal", eaten.kcal, target.kcal);
  const over = kcal === "over";
  const on = !over
    && kcal === "hit"
    && macroStatus("p", eaten.protein, target.protein) === "hit"
    && macroStatus("f", eaten.fat, target.fat) === "hit"
    && macroStatus("c", eaten.carbs, target.carbs) === "hit";
  const bar = target.kcal > 0 ? eaten.kcal / (target.kcal * 1.2) : null;
  return { future, logged, targetKcal, on, over, bar };
}
