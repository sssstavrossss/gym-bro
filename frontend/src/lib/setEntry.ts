import type { DraftSet } from "./workout";

// What a set is called on the workout's timeline (README, *Logging a workout*): its node shows the label, and its
// buttons and the number wheel say its name.

/** W for a warm-up, D for a drop set, else the working set's number. */
export function setLabels(sets: readonly Pick<DraftSet, "type">[]): string[] {
  let n = 0;
  return sets.map((set) => (set.type === "warmup" ? "W" : set.type === "drop" ? "D" : String(++n)));
}

/** "Set 3", "Warm-up set 2", "Drop set". One past the end is the set that a log would add. */
export function setName(sets: readonly Pick<DraftSet, "type">[], index: number): string {
  if (index >= sets.length) return `Set ${sets.filter((set) => set.type !== "warmup" && set.type !== "drop").length + 1}`;
  const labels = setLabels(sets);
  const label = labels[index];
  if (label === "D") return "Drop set";
  if (label !== "W") return `Set ${label}`;
  const warmups = labels.filter((each) => each === "W").length;
  return warmups > 1 ? `Warm-up set ${labels.slice(0, index + 1).filter((each) => each === "W").length}` : "Warm-up set";
}
