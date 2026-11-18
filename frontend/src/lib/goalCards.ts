import type { GoalLine } from "./goalLine";
import { formatDecimal, int } from "./format";
import type { FatLimits } from "./nutrientCards";
import type { MacroSetting } from "./nutrition";

/** A macro set by hand rather than by a preset: no Less/Normal/More is lit, so the row says so. */
export function isExact(setting: MacroSetting): boolean {
  return setting === "exact";
}

/** "2.0 g/kg · 165 g", or just the rate before there are targets. */
export function proteinCaption(gramsPerKg: string, grams: number | null): string {
  return grams == null ? `${gramsPerKg} g/kg` : `${gramsPerKg} g/kg · ${int(grams)} g`;
}

/** "25% · 62 g", or just the share before there are targets. */
export function fatCaption(percent: string, grams: number | null): string {
  return grams == null ? `${percent}%` : `${percent}% · ${int(grams)} g`;
}

/** The saturated fat limit in grams for the kcal target, with cholesterol on Strict. */
export function saturatedCaption(limits: FatLimits): string {
  const saturated = limits.saturatedGrams == null ? `≤ ${limits.saturatedPercent}% of calories` : `≤ ${int(limits.saturatedGrams)} g`;
  if (limits.cholesterolMg == null) return limits.saturatedGrams == null ? saturated : `${saturated} a day`;
  return `${saturated}, cholesterol ≤ ${int(limits.cholesterolMg)} mg`;
}

/** The sodium limit with the salt it adds up to: "≤ 2,300 mg a day · 5.8 g salt". */
export function sodiumCaption(limitMg: number): string {
  return `≤ ${int(limitMg)} mg a day · ${formatDecimal((limitMg * 2.5) / 1000, 1)} g salt`;
}

/** The three figures under Goal: what is left, how long, and roughly when. */
export function goalStats(line: Extract<GoalLine, { kind: "way" }>, weight: (kg: number) => string, unit: string): { label: string; value: string }[] {
  return [
    { label: "To go", value: `${weight(line.leftKg)} ${unit}` },
    { label: "Takes about", value: line.weeks === 1 ? "1 week" : `${line.weeks} weeks` },
    { label: "Reached", value: line.by },
  ];
}

/** The line under the number on the goal weight sheet, for the weight being typed. */
export function goalSheetHint(line: GoalLine | null, trend: string | null, unit: string, weight: (kg: number) => string): string {
  if (line?.kind === "reached") return "You're at this weight now.";
  if (line?.kind === "way") {
    const weeks = line.weeks === 1 ? "1 week" : `${line.weeks} weeks`;
    return `${weight(line.leftKg)} ${unit} to go · about ${weeks} (${line.by})`;
  }
  return trend ? `Your trend weight is ${trend} ${unit}.` : "";
}

/** One whole unit up or down for − and +, from a whole number or by rounding to one, kept inside the range. */
export function stepWhole(value: number, step: -1 | 1, min: number, max: number): number {
  const base = Number.isInteger(value) ? value : step > 0 ? Math.ceil(value) - 1 : Math.floor(value) + 1;
  return Math.min(max, Math.max(min, base + step));
}
