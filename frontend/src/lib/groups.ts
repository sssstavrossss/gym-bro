import { amountLabel } from "./foodAmount";
import { int } from "./format";

export const groupNameMax = 40;

export interface GroupLine {
  amount: number;
  unit: string;
  grams: number | null;
  kcal: number;
}

export interface GroupMatch {
  name: string;
  items: { name: string }[];
}

/** An empty name becomes "My group", matching the save sheet. */
export function groupName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  return name || "My group";
}

/** Save as group needs at least two foods. One entry is just a log row. */
export function canSaveGroup(count: number): boolean {
  return count >= 2;
}

/**
 * A past day has no default time. Add stays off until a time is picked.
 * Today can mean now.
 */
export function groupAddNeedsTime(date: string, today: string, picked: string | null): boolean {
  return date !== today && !picked;
}

export function matchingGroups<T extends GroupMatch>(groups: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups.filter((group) =>
    group.name.toLowerCase().includes(needle)
    || group.items.some((item) => item.name.toLowerCase().includes(needle)));
}

export function groupItemLine(item: GroupLine): string {
  const amount = item.unit
    ? amountLabel(item.amount, item.unit)
    : item.grams ? `${item.grams} g` : "";
  const kcal = `${int(item.kcal)} kcal`;
  return amount ? `${amount} · ${kcal}` : kcal;
}

/** The sentence after a re-add. A skip notice names each food that was left out. */
export function readdToast(name: string, added: number, kcal: number, notice: string): string {
  const extra = notice.trim();
  if (added <= 0) return extra || `Nothing from ${name} was added.`;
  const base = `Added ${name} · ${added} item${added === 1 ? "" : "s"} · ${int(kcal)} kcal`;
  return extra ? `${base}. ${extra}` : base;
}

export function groupTimeNote(needsTime: boolean, past: boolean, picked: string | null): string {
  if (needsTime) return "at the time you pick";
  if (picked || past) return `at ${picked}`;
  return "now";
}
