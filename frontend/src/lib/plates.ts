// Plate maths for a barbell (docs/training.md, phase 5): what to load on each side for a weight.
import { BAR_KG } from "./warmup";

/** The plates a gym has, heaviest first. */
export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export interface PlateLoad {
  /** One side's plates, heaviest first. Empty for the bar alone or a weight under it. */
  side: number[];
  /** What the bar weighs with them: the weight asked for, or the nearest under it the plates make. */
  loaded: number;
}

/** The fewest plates a side for a weight, heaviest first. Null with no weight. */
export function platesFor(kg: number | null | undefined, bar = BAR_KG): PlateLoad | null {
  if (kg == null || !(kg > 0)) return null;
  if (kg <= bar) return { side: [], loaded: bar };
  // In hundredths, so 1.25 adds up exactly.
  let left = Math.floor(((kg - bar) / 2) * 100 + 1e-6);
  const side: number[] = [];
  for (const plate of PLATES) {
    const size = Math.round(plate * 100);
    while (left >= size) {
      side.push(plate);
      left -= size;
    }
  }
  const loaded = bar + 2 * side.reduce((sum, plate) => sum + plate, 0);
  return { side, loaded: Math.round(loaded * 100) / 100 };
}

const num = (kg: number) => String(Math.round(kg * 100) / 100);

/** "Plates for 100 kg: 25 + 15 a side"; "(97.5 kg)" after it when the plates can't make the weight exactly. */
export function plateLine(kg: number | null | undefined, bar = BAR_KG): string {
  const load = platesFor(kg, bar);
  if (!load || kg == null) return "Plates show for the weight you type";
  const head = `Plates for ${num(kg)} kg: `;
  if (kg < bar) return `${head}under the ${num(bar)} kg bar`;
  if (!load.side.length) return `${head}just the bar`;
  const exact = Math.abs(load.loaded - kg) < 0.005 ? "" : ` (${num(load.loaded)} kg)`;
  return `${head}${load.side.map(num).join(" + ")} a side${exact}`;
}
