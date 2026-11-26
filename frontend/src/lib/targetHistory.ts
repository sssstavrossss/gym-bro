import type { TargetHistoryRow, TargetProfileChange } from "../api";
import { monthKey, monthName, spanLabel } from "./dates";
import { int } from "./format";
import { capPercent } from "./recalculate";

/** How the history shows weights and heights. Passed in so this stays free of the unit settings. */
export interface HistoryUnits {
  /** A weight number in the shown unit: "78" or "172". */
  weight: (kg: number) => string;
  /** A signed weight change: "−0.49". */
  weightSigned: (kg: number) => string;
  weightUnit: string;
  /** A height with its unit: "180 cm" or "5 ft 11 in". */
  height: (cm: number) => string;
}

const has = (row: TargetHistoryRow, reason: string) => row.reasons.includes(reason);
const isRecalculation = (row: TargetHistoryRow) =>
  has(row, "recalculation_adaptive") || has(row, "recalculation_formula") || has(row, "recalculation_kept");

export function historyTitle(row: TargetHistoryRow): string {
  if (row.kind === "declined") return "Declined";
  if (isRecalculation(row)) return "Recalculated";
  if (has(row, "weekly_recalculation")) return "Weekly update";
  if (has(row, "fresh_start")) return "Fresh start";
  if (has(row, "macro_balance_change")) return "Macro balance change";
  if (has(row, "manual_changed")) return "Own number changed";
  if (has(row, "mode_switch")) return "Goal mode switch";
  if (row.previousKcal == null) return "Set up";
  if (has(row, "profile_change")) return "Profile change";
  return "Target change";
}

const activities: Record<string, string> = {
  sedentary: "Sedentary", light: "Light", moderate: "Moderate", very_active: "Very active", athlete: "Athlete",
};
const goals: Record<string, string> = { lose: "Lose", maintain: "Maintain", gain: "Gain" };

/** "Goal weight 80 → 78 kg". Values arrive as invariant text in kg, cm, g/kg and %. */
export function changeLabel(change: TargetProfileChange, units: HistoryUnits): string {
  const num = (text: string) => Number(text);
  const pair = (label: string, from: string, to: string, unit = "") => `${label} ${from} → ${to}${unit}`;
  switch (change.field) {
    case "sex": return pair("Sex", change.from, change.to);
    case "birthYear": return pair("Birth year", change.from, change.to);
    case "heightCm": return pair("Height", units.height(num(change.from)), units.height(num(change.to)));
    case "activity": return pair("Activity", activities[change.from] ?? change.from, activities[change.to] ?? change.to);
    case "goal": return pair("Goal", goals[change.from] ?? change.from, goals[change.to] ?? change.to);
    case "rateKgPerWeek": return pair("Rate", units.weight(num(change.from)), units.weight(num(change.to)), ` ${units.weightUnit}/wk`);
    case "goalWeightKg": return pair("Goal weight", units.weight(num(change.from)), units.weight(num(change.to)), ` ${units.weightUnit}`);
    case "proteinGramsPerKg": return pair("Protein", change.from, change.to, " g/kg");
    case "fatPercent": return pair("Fat", change.from, change.to, "%");
    default: return pair(change.field, change.from, change.to);
  }
}

/** The second line under a row's title. */
export function historySub(row: TargetHistoryRow, units: HistoryUnits): string {
  if (row.kind === "declined") return `Suggested ${int(row.suggestedKcal ?? row.kcal)} · kept ${int(row.kcal)}`;
  if (has(row, "recalculation_kept")) return `Burn kept at ${int(row.burn)}`;
  if (has(row, "recalculation_formula")) return `From the formula · burn ${int(row.burn)}`;
  if (has(row, "recalculation_adaptive") || has(row, "weekly_recalculation")) {
    const details = row.recalculation;
    const far = historyFar(row);
    if (far != null) return `Burn ${int(row.burn)} · well ${far > 0 ? "above" : "below"} usual`;
    if (details?.capped && details.priorBurn != null && details.measuredBurn != null && details.burn != null) {
      const moved = int(Math.abs(details.burn - details.priorBurn));
      const gap = int(Math.abs(details.measuredBurn - details.priorBurn));
      return `Burn ${int(row.burn)} · moved ${moved} of ${gap} (${capPercent(details.tier)}% cap)`;
    }
    return row.previousBurn != null && row.previousBurn !== row.burn
      ? `Burn ${int(row.previousBurn)} → ${int(row.burn)}`
      : `Burn ${int(row.burn)}`;
  }
  if (row.changes?.length) return row.changes.map((change) => changeLabel(change, units)).join(" · ");
  if (row.previousKcal == null || has(row, "fresh_start")) return `Formula · burn ${int(row.burn)}`;
  return "";
}

/**
 * How far a recalculation's burn was from the formula's, as a share, when it was saved as far
 * (more than 25%). Null for other rows and rows saved before the rolling readings.
 */
export function historyFar(row: TargetHistoryRow): number | null {
  const details = row.recalculation;
  if (!details?.far || details.burn == null || !details.formulaBurn) return null;
  return (details.burn - details.formulaBurn) / details.formulaBurn;
}

export const historyFarNote =
  "Your burn is well away from the usual for your size and activity. That can be right; check that your logs are complete. It keeps adjusting with each weigh-in.";

/** "−194", "+60", or null for no change or the first row. */
export function changeChip(row: TargetHistoryRow): string | null {
  if (row.kind === "declined" || row.previousKcal == null) return null;
  const diff = row.kcal - row.previousKcal;
  if (diff === 0) return null;
  return `${diff > 0 ? "+" : "−"}${int(Math.abs(diff))}`;
}

/** The saved details of a recalculation, as label and value pairs. Empty for other rows. */
export function detailRows(row: TargetHistoryRow, units: HistoryUnits): [string, string][] {
  const details = row.recalculation;
  if (!details) return [];
  const rows: [string, string][] = [["Period", spanLabel(details.from, details.to)]];
  let counted = `${details.countedDays} of ${details.periodDays}`;
  if (details.lowDays > 0) {
    const out = details.lowDays - details.lowCounted;
    counted += out > 0 ? ` · ${out} low left out` : ` · ${details.lowDays} low`;
  }
  rows.push(["Days counted", counted]);
  if (details.readings != null) {
    // Saved from the rolling readings: where the readings pointed, the capped move and the range.
    const lessSure = details.lessSure ?? 0;
    const sure = details.readings === 0 ? "" : lessSure > 0 ? ` · ${lessSure} less sure` : " · all sure";
    rows.push(["Weigh-ins", `${details.weighIns}${sure}`]);
    if (details.averageKcal != null) rows.push(["Ate", `${int(details.averageKcal)} a day`]);
    rows.push(["Readings point to", details.measured && details.measuredBurn != null
      ? `${int(details.measuredBurn)} ± ${int(details.measuredSd ?? 0)}`
      : "Not measured"]);
    const burn = details.burn ?? row.burn;
    rows.push(["Burn", details.measured && details.priorBurn != null && details.priorBurn !== burn
      ? `${int(details.priorBurn)} → ${int(burn)}`
      : int(burn)]);
    const far = historyFar(row);
    if (details.burnSd != null) {
      rows.push(["Range", `${int(burn - details.burnSd)}–${int(burn + details.burnSd)}${far != null ? " (wide)" : ""}`]);
    }
    if (details.formulaBurn != null) {
      const off = far != null ? ` · burn ${Math.round(Math.abs(far) * 100)}% ${far > 0 ? "above" : "below"}` : "";
      rows.push(["Usual for you", `${int(details.formulaBurn)}${off}`]);
    }
    rows.push(["Macros", `P${row.protein} · F${row.fat} · C${row.carbs}`]);
    return rows;
  }
  if (details.rateKgPerWeek != null) {
    rows.push(["Weight", `${units.weightSigned(details.rateKgPerWeek)} ${units.weightUnit} a week`]);
    rows.push(["Weigh-ins", String(details.weighIns)]);
  } else if (details.weighIns > 0) {
    rows.push(["Weight", `${details.weighIns} weigh-ins`]);
  }
  if (details.averageKcal != null) rows.push(["Ate", `${int(details.averageKcal)} a day`]);
  rows.push(["Measured burn", details.measured && details.measuredBurn != null
    ? `${int(details.measuredBurn)} ± ${int(details.measuredSd ?? 0)}`
    : "Not measured"]);
  if (details.stepPercent != null) rows.push(["Moved", `${details.stepPercent}% of the way`]);
  rows.push(["Macros", `P${row.protein} · F${row.fat} · C${row.carbs}`]);
  return rows;
}

export type HistoryItem =
  | { kind: "month"; key: string; label: string }
  | { kind: "row"; key: string; row: TargetHistoryRow }
  | { kind: "declines"; key: string; rows: TargetHistoryRow[]; label: string };

/**
 * The list as shown: newest first, a month label where the month changes, and
 * declines in a row folded into one line ("Declined 3 times · 20 Oct – 3 Nov").
 */
export function historyItems(rows: readonly TargetHistoryRow[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  let month = "";
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const key = monthKey(row.date);
    if (key !== month) {
      month = key;
      items.push({ kind: "month", key: `m-${key}`, label: monthName(key) });
    }
    if (row.kind === "declined") {
      // A run sits under its newest decline's month, even when it started the month before.
      let end = i;
      while (end + 1 < rows.length && rows[end + 1].kind === "declined") end += 1;
      if (end > i) {
        const run = rows.slice(i, end + 1);
        const oldest = run[run.length - 1].date;
        items.push({ kind: "declines", key: `d-${row.date}-${i}`, rows: run, label: `Declined ${run.length} times · ${spanLabel(oldest, row.date)}` });
        i = end;
        continue;
      }
    }
    items.push({ kind: "row", key: `r-${row.kind}-${row.date}-${i}`, row });
  }
  return items;
}
