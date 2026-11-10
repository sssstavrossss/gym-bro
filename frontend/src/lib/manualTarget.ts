/**
 * The prototype's "M" is a manual calorie target ("my own number"), not a
 * quick-add food. The shipped target row records that only by reason.
 * These are the prototype's reason codes. A rate-based target never carries them.
 */
export const manualTargetReasons = ["manual_changed", "mode_switch"] as const;

export function isManualTarget(reasons: readonly string[] | null | undefined): boolean {
  if (!reasons?.length) return false;
  return reasons.some((reason) => reason === "manual_changed" || reason === "mode_switch");
}
