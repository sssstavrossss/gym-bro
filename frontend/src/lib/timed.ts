// Blocks done on the clock (docs/training.md, phase 6): EMOM, AMRAP and for time. A block is a superset or circuit
// (a run of exercises, lib/workout.ts `exerciseGroups`); its first exercise carries the format, the clock and the
// score. A round is one set of each exercise in the run, so the sets are the rounds.
import { clock, emptySet, groupName, setCounts, type DraftExercise, type DraftSet } from "./workout";

export type BlockFormat = "emom" | "amrap" | "for_time";

export interface TimedState {
  format: BlockFormat;
  /** EMOM and AMRAP: how long, in minutes. */
  minutes: number;
  /** EMOM: a round every this many minutes. */
  every: number;
  /** When the clock was started and stopped (ISO), or null. EMOM and AMRAP also stop on their own at the time. */
  startedAt: string | null;
  endedAt: string | null;
  /** AMRAP: reps done into the round after the last whole one. */
  reps: number | null;
  /** For time: how long the rounds took. */
  seconds: number | null;
}

/** A timed block as `PUT /api/workouts/{id}` takes it. */
export interface TimedBlockBody {
  block: number;
  format: BlockFormat;
  minutes: number | null;
  every: number | null;
  rounds: number | null;
  reps: number | null;
  seconds: number | null;
}

export const FORMAT_OPTIONS: { value: BlockFormat | "rounds"; label: string }[] = [
  { value: "rounds", label: "Rounds" },
  { value: "emom", label: "EMOM" },
  { value: "amrap", label: "AMRAP" },
  { value: "for_time", label: "For time" },
];

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;
export const MAX_EVERY = 5;
export const MAX_EXTRA_REPS = 999;
const DEFAULT_MINUTES: Record<BlockFormat, number> = { emom: 10, amrap: 12, for_time: 0 };

export function newTimed(format: BlockFormat, before?: TimedState | null): TimedState {
  const minutes = format === "for_time" ? 0 : before && before.format !== "for_time" ? before.minutes : DEFAULT_MINUTES[format];
  return { format, minutes, every: before?.every ?? 1, startedAt: null, endedAt: null, reps: null, seconds: null };
}

export function formatLabel(timed: TimedState | null | undefined): string {
  return FORMAT_OPTIONS.find((option) => option.value === (timed?.format ?? "rounds"))!.label;
}

const working = (sets: readonly DraftSet[]) => sets.filter((set) => set.type !== "warmup");

/** EMOM: one round each interval. For time: as many rounds as the run has sets. AMRAP: open, so null. */
export function plannedRounds(timed: TimedState, run: readonly DraftExercise[]): number | null {
  if (timed.format === "emom") return Math.max(1, Math.floor(timed.minutes / timed.every));
  if (timed.format === "for_time") return Math.max(0, ...run.map((exercise) => working(exercise.sets).length));
  return null;
}

/** Whole rounds done: the fewest ticked working sets of any exercise in the run. */
export function roundsDone(run: readonly DraftExercise[]): number {
  return run.length ? Math.min(...run.map((exercise) => exercise.sets.filter(setCounts).length)) : 0;
}

/** An exercise with `rounds` working sets: new ones are added empty, unticked ones past the count go; ticked ones stay. */
export function fitSets(exercise: DraftExercise, rounds: number): DraftExercise {
  const sets = [...exercise.sets];
  let count = working(sets).length;
  for (let at = sets.length - 1; at >= 0 && count > rounds; at--) {
    if (sets[at].type !== "warmup" && !sets[at].doneAt) {
      sets.splice(at, 1);
      count--;
    }
  }
  while (count < rounds) {
    sets.push(emptySet());
    count++;
  }
  return { ...exercise, sets };
}

/**
 * The set to tick for the next round: the first working set not ticked yet. An AMRAP runs on past its sets, so it
 * gets a new one like the last; the other formats stop at their last round (null).
 */
export function nextRoundSet(exercise: DraftExercise, format: BlockFormat): { exercise: DraftExercise; index: number } | null {
  const index = exercise.sets.findIndex((set) => set.type !== "warmup" && !set.doneAt);
  if (index >= 0) return { exercise, index };
  if (format !== "amrap") return null;
  const last = working(exercise.sets).at(-1);
  const set: DraftSet = last ? { ...last, doneAt: null } : emptySet();
  return { exercise: { ...exercise, sets: [...exercise.sets, set] }, index: exercise.sets.length };
}

function elapsed(timed: TimedState, now: number): number {
  if (!timed.startedAt) return 0;
  const end = timed.endedAt ? Date.parse(timed.endedAt) : now;
  return Math.max(0, (end - Date.parse(timed.startedAt)) / 1000);
}

/** Whether the clock has stopped: by hand, at its time, or (for time) once every round is ticked. */
export function clockOver(timed: TimedState, now: number): boolean {
  if (!timed.startedAt) return false;
  if (timed.endedAt) return true;
  return timed.format !== "for_time" && elapsed(timed, now) >= timed.minutes * 60;
}

export type ClockPhase = "ready" | "running" | "over";

export interface ClockView {
  phase: ClockPhase;
  /** The big number: time left in the round (EMOM), left (AMRAP), or gone (for time). */
  time: string;
  caption: string;
  /** EMOM: the round now, from 1, for a buzz as each starts. */
  round: number;
}

export function clockView(timed: TimedState, run: readonly DraftExercise[], now: number): ClockView {
  const planned = plannedRounds(timed, run);
  const done = roundsDone(run);
  if (!timed.startedAt) {
    const time = timed.format === "for_time" ? clock(0) : clock(timed.minutes * 60);
    return { phase: "ready", time, caption: readyLine(timed, run), round: 0 };
  }
  const gone = elapsed(timed, now);
  if (clockOver(timed, now)) return { phase: "over", time: timed.format === "for_time" ? clock(timed.seconds ?? gone) : clock(0), caption: "Time", round: 0 };
  if (timed.format === "emom") {
    const length = timed.every * 60;
    const round = Math.floor(gone / length) + 1;
    return { phase: "running", time: clock(Math.ceil(length - (gone % length))), caption: `Round ${round} of ${planned}`, round };
  }
  if (timed.format === "amrap") {
    return { phase: "running", time: clock(Math.ceil(timed.minutes * 60 - gone)), caption: `${done} ${done === 1 ? "round" : "rounds"} so far`, round: 0 };
  }
  return { phase: "running", time: clock(gone), caption: `Round ${Math.min(done + 1, planned ?? 1)} of ${planned}`, round: 0 };
}

function readyLine(timed: TimedState, run: readonly DraftExercise[]): string {
  if (timed.format === "emom") return `${plannedRounds(timed, run)} rounds, one ${timed.every === 1 ? "each minute" : `every ${timed.every} minutes`}`;
  if (timed.format === "amrap") return `As many rounds as you can in ${timed.minutes} min`;
  const rounds = plannedRounds(timed, run) ?? 0;
  return `${rounds} ${rounds === 1 ? "round" : "rounds"} as fast as you can`;
}

/** The run's heading: what it is and how it's done. */
export function runHeading(timed: TimedState | null | undefined, run: readonly DraftExercise[]): string {
  if (!timed) return `${groupName(run.length)} · rest after each round`;
  if (timed.format === "emom") return `EMOM ${timed.minutes} min · a round ${timed.every === 1 ? "each minute" : `every ${timed.every} minutes`}`;
  if (timed.format === "amrap") return `AMRAP ${timed.minutes} min · as many rounds as you can`;
  return `For time · ${plannedRounds(timed, run)} rounds`;
}

/** The score, for the block once it's done, the summary and a past workout. */
export function scoreLine(timed: TimedState, run: readonly DraftExercise[]): string {
  const done = roundsDone(run);
  const rounds = `${done} ${done === 1 ? "round" : "rounds"}`;
  if (timed.format === "emom") return `EMOM ${timed.minutes} min · ${done} of ${plannedRounds(timed, run)} rounds`;
  if (timed.format === "amrap") return `AMRAP ${timed.minutes} min · ${rounds}${timed.reps ? ` + ${timed.reps} ${timed.reps === 1 ? "rep" : "reps"}` : ""}`;
  return timed.seconds != null ? `For time · ${clock(timed.seconds)}` : `For time · ${done} of ${plannedRounds(timed, run)} rounds`;
}

/** Stopped now: the end time, and for time, how long it took. A clock never started stays as it is. */
export function stopped(timed: TimedState, now: Date): TimedState {
  if (!timed.startedAt || timed.endedAt) return timed;
  const end = timed.format === "for_time" ? now : new Date(Math.min(now.getTime(), Date.parse(timed.startedAt) + timed.minutes * 60_000));
  const seconds = timed.format === "for_time" ? Math.round((end.getTime() - Date.parse(timed.startedAt)) / 1000) : timed.seconds;
  return { ...timed, endedAt: end.toISOString(), seconds };
}

export function toBlockBody(timed: TimedState, run: readonly DraftExercise[], block: number): TimedBlockBody {
  return {
    block,
    format: timed.format,
    minutes: timed.format === "for_time" ? null : timed.minutes,
    every: timed.format === "emom" ? timed.every : null,
    rounds: timed.format === "amrap" ? roundsDone(run) : null,
    reps: timed.format === "amrap" ? timed.reps : null,
    seconds: timed.format === "for_time" ? timed.seconds : null,
  };
}

/** A saved block back on its run's first exercise. Its clock is over: only the score is kept. */
export function fromBlockBody(block: TimedBlockBody): TimedState {
  return {
    format: block.format,
    minutes: block.minutes ?? 0,
    every: block.every ?? 1,
    startedAt: null,
    endedAt: null,
    reps: block.reps,
    seconds: block.seconds,
  };
}
