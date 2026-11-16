import { reactive } from "vue";
import { getNutrientWeek } from "../api";
import type { NutrientMap } from "../lib/nutrients";

/** The daily average over the seven days ending on `date`: the rings' inner circle and the nutrient sheet. */
export const nutrientWeek = reactive({
  date: "",
  loggedDays: 0,
  average: {} as NutrientMap,
});

let latest = 0;

/** Loads the week ending on `date`. Until it arrives, or if it fails, the average is empty and the inner rings hide. */
export async function loadNutrientWeek(date: string): Promise<void> {
  const ticket = ++latest;
  if (nutrientWeek.date !== date) {
    nutrientWeek.date = date;
    nutrientWeek.loggedDays = 0;
    nutrientWeek.average = {};
  }
  try {
    const week = await getNutrientWeek(date);
    if (ticket !== latest) return;
    nutrientWeek.loggedDays = week.loggedDays;
    nutrientWeek.average = week.average;
  } catch {
    // Offline or a failed request: the card still shows the day, without the week ring.
  }
}
