/**
 * Open S8 Part A edges. Each function is the only switch for that behaviour in the UI.
 * (1) and (4) are decided on the server (PartADecisions.cs). This screen follows the API.
 * (3) is the spoken reason, which only the UI has.
 */

/**
 * (2) Deleting the only weigh-in.
 * Current spec: allowed. The trend becomes empty, the same as never having entered it.
 * Keep this in step with PartADecisions.AllowDeletingTheOnlyWeighIn.
 */
export function allowDeletingTheOnlyWeighIn(): boolean {
  return true;
}

/**
 * (3) Dot wording when the last 7 days contain no real weigh-in.
 * Current spec: say there were none, and how long ago the last one was.
 */
export function zeroWeighInsDotCopy(daysSinceLast: number | null): { short: string; line: string } {
  const ago = daysSinceLast == null ? "" : ` (last one ${daysSinceLast} days ago)`;
  return {
    short: "no weigh-ins this week",
    line: `No weigh-ins in the last 7 days${ago}, so the trend is less accurate. Weighing in 2+ times a week helps.`,
  };
}
