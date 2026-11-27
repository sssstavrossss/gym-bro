// Reading a workout export from Strong or Hevy (Train → Trained before? → Import). The phone reads the file; the
// server matches the exercise names (POST /api/exercises/match) and saves the workouts (POST /api/workouts/import).

export type WorkoutApp = "strong" | "hevy";
export type ImportUnit = "kg" | "lb";
type DistanceUnit = "m" | "km" | "mi";
type SetType = "warmup" | "working" | "drop";

export interface ImportSet {
  exercise: string;
  /** Exercises in the order done; a Hevy superset shares one. */
  block: number;
  type: SetType;
  weight: number | null;
  /** Null when the file doesn't say (an old Strong export): the person picks kg or lb. */
  weightUnit: ImportUnit | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  distanceUnit: DistanceUnit | null;
  rpe: number | null;
}

export interface ImportWorkout {
  /** Marks the workout in the file, so importing it again skips it. */
  key: string;
  name: string | null;
  /** Local time as the file has it: "2024-01-15T18:30". */
  start: string;
  end: string | null;
  notes: string | null;
  sets: ImportSet[];
}

export interface ImportFile {
  source: WorkoutApp;
  workouts: ImportWorkout[];
  /** Each exercise name once, in the order first done. */
  exercises: string[];
  /** False when the weights carry no unit, so kg or lb has to be picked. */
  unitKnown: boolean;
}

export const NOT_AN_EXPORT = "This file isn't a workout export from Strong or Hevy.";
export const NO_WORKOUTS = "There are no workouts in this file.";

/** Rows of fields, from CSV with commas or semicolons, quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.slice(0, body.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < body.length; at++) {
    const char = body[at];
    if (quoted) {
      if (char === '"' && body[at + 1] === '"') {
        field += '"';
        at++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[at + 1] === "\n") at++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: number) => String(value).padStart(2, "0");

function stamp(year: number, month: number, day: number, hour: number, minute: number, half?: string): string | null {
  let h = hour;
  if (half) {
    const pm = half.toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || minute > 59) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(minute)}`;
}

/** "2024-01-15 18:30:00", "26 Nov 2024, 18:03" or "Nov 26, 2024, 6:03 PM", as a local "2024-01-15T18:30". */
export function localStamp(text: string): string | null {
  const value = text.trim();
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (match) return stamp(+match[1], +match[2], +match[3], +match[4], +match[5]);
  match = value.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (match) return stamp(+match[3], MONTHS.indexOf(match[2].toLowerCase()) + 1, +match[1], +match[4], +match[5], match[6]);
  match = value.match(/^([a-z]{3})[a-z]* (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (match) return stamp(+match[3], MONTHS.indexOf(match[1].toLowerCase()) + 1, +match[2], +match[4], +match[5], match[6]);
  return null;
}

/** A local stamp plus some seconds, still local. */
export function addSeconds(local: string, seconds: number): string {
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day, hour, minute) + Math.round(seconds / 60) * 60_000);
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}T${pad(moved.getUTCHours())}:${pad(moved.getUTCMinutes())}`;
}

/** Strong's "1h 5m", "45m" or "30s", in seconds. */
export function durationSeconds(text: string): number | null {
  const value = text.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const parts = [...value.matchAll(/(\d+)\s*([hms])/g)];
  if (!parts.length) return null;
  return parts.reduce((sum, [, amount, unit]) => sum + Number(amount) * (unit === "h" ? 3600 : unit === "m" ? 60 : 1), 0);
}

/** A number from the file; 0 and blanks are none (Strong writes 0 for fields an exercise doesn't use). */
function amount(text: string | undefined): number | null {
  const value = (text ?? "").trim().replace(/^(\d+),(\d+)$/, "$1.$2");
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function columns(header: string[]) {
  const names = header.map((name) => name.trim().toLowerCase());
  return (...wanted: string[]) => {
    for (const name of wanted) {
      const at = names.indexOf(name);
      if (at >= 0) return at;
    }
    return -1;
  };
}

function weightUnitOf(text: string | undefined): ImportUnit | null {
  const value = (text ?? "").trim().toLowerCase();
  if (value === "kg" || value === "kgs") return "kg";
  if (value === "lb" || value === "lbs") return "lb";
  return null;
}

function distanceUnitOf(text: string | undefined): DistanceUnit | null {
  const value = (text ?? "").trim().toLowerCase();
  if (value === "km") return "km";
  if (value === "m" || value === "meters" || value === "metres") return "m";
  if (value === "mi" || value === "miles") return "mi";
  return null;
}

const clean = (text: string | undefined) => (text ?? "").trim() || null;

/** Reads a Strong or Hevy export into workouts, or says why it can't. */
export function readExport(text: string): ImportFile | { error: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: rows.length ? NO_WORKOUTS : NOT_AN_EXPORT };
  const col = columns(rows[0]);
  const hevy = col("exercise_title") >= 0 && col("start_time") >= 0;
  const strong = !hevy && col("exercise name") >= 0 && col("date") >= 0;
  if (!hevy && !strong) return { error: NOT_AN_EXPORT };

  const at = hevy
    ? {
      start: col("start_time"), end: col("end_time"), name: col("title"), notes: col("description"), exercise: col("exercise_title"),
      superset: col("superset_id"), type: col("set_type"), reps: col("reps"), seconds: col("duration_seconds"), rpe: col("rpe"),
      kg: col("weight_kg"), lb: col("weight_lbs"), weight: -1, weightUnit: -1, km: col("distance_km"), mi: col("distance_miles"),
      m: col("distance_meters"), distance: -1, distanceUnit: -1, duration: -1,
    }
    : {
      start: col("date"), end: -1, name: col("workout name"), notes: col("workout notes"), exercise: col("exercise name"),
      superset: -1, type: col("set order"), reps: col("reps"), seconds: col("seconds"), rpe: col("rpe"),
      kg: col("weight (kg)"), lb: col("weight (lbs)", "weight (lb)"), weight: col("weight"), weightUnit: col("weight unit"),
      km: col("distance (km)"), mi: col("distance (miles)", "distance (mi)"), m: col("distance (meters)", "distance (m)"),
      distance: col("distance"), distanceUnit: col("distance unit"), duration: col("duration (sec)", "duration", "workout duration"),
    };
  const unitKnown = at.kg >= 0 || at.lb >= 0 || at.weightUnit >= 0;

  const workouts: ImportWorkout[] = [];
  const exercises: string[] = [];
  let current: ImportWorkout | null = null;
  let lastGroup = "";
  let nextBlock = 0;
  let block = 0;
  let supersets = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const start = localStamp(row[at.start] ?? "");
    const exercise = clean(row[at.exercise]);
    const order = (row[at.type] ?? "").trim().toLowerCase();
    if (!start || !exercise || exercise.toLowerCase() === "rest timer" || order === "rest timer") continue;
    const name = clean(row[at.name]);
    const key = `${start}|${name ?? ""}`;
    if (!current || current.key !== key) {
      const seconds = at.duration >= 0 ? durationSeconds(row[at.duration] ?? "") : null;
      const end = at.end >= 0 ? localStamp(row[at.end] ?? "") : seconds ? addSeconds(start, seconds) : null;
      current = workouts.find((item) => item.key === key) ?? null;
      if (!current) {
        current = { key, name, start, end, notes: clean(row[at.notes]), sets: [] };
        workouts.push(current);
      }
      lastGroup = "";
      nextBlock = current.sets.reduce((most, set) => Math.max(most, set.block + 1), 0);
      supersets = new Map();
    }
    if (!exercises.includes(exercise)) exercises.push(exercise);

    // A new block each time the exercise changes; Hevy's supersets share one.
    const superset = at.superset >= 0 ? clean(row[at.superset]) : null;
    const group = superset ? `superset:${superset}` : `exercise:${exercise}`;
    if (group !== lastGroup) {
      const joined = superset ? supersets.get(superset) : undefined;
      block = joined ?? nextBlock++;
      if (superset && joined === undefined) supersets.set(superset, block);
      lastGroup = group;
    }

    const weightKg = at.kg >= 0 ? amount(row[at.kg]) : null;
    const weightLb = at.lb >= 0 ? amount(row[at.lb]) : null;
    const weight = weightKg ?? weightLb ?? (at.weight >= 0 ? amount(row[at.weight]) : null);
    const weightUnit = weightKg != null ? "kg" : weightLb != null ? "lb" : at.weightUnit >= 0 ? weightUnitOf(row[at.weightUnit]) : null;
    const km = at.km >= 0 ? amount(row[at.km]) : null;
    const mi = at.mi >= 0 ? amount(row[at.mi]) : null;
    const m = at.m >= 0 ? amount(row[at.m]) : null;
    const distance = km ?? mi ?? m ?? (at.distance >= 0 ? amount(row[at.distance]) : null);
    const distanceUnit = km != null ? "km" : mi != null ? "mi" : m != null ? "m" : at.distanceUnit >= 0 ? distanceUnitOf(row[at.distanceUnit]) : null;
    const reps = amount(row[at.reps]);
    const seconds = amount(row[at.seconds]);
    if (weight == null && reps == null && seconds == null && distance == null) continue;
    const type: SetType = order === "w" || order === "warmup" ? "warmup" : order === "d" || order === "dropset" ? "drop" : "working";
    current.sets.push({
      exercise, block, type, weight, weightUnit, reps: reps == null ? null : Math.round(reps), seconds: seconds == null ? null : Math.round(seconds),
      distance, distanceUnit, rpe: amount(row[at.rpe]),
    });
  }

  const kept = workouts.filter((item) => item.sets.length);
  if (!kept.length) return { error: NO_WORKOUTS };
  kept.sort((a, b) => a.start.localeCompare(b.start));
  const used = new Set(kept.flatMap((item) => item.sets.map((set) => set.exercise)));
  return { source: hevy ? "hevy" : "strong", workouts: kept, exercises: exercises.filter((name) => used.has(name)), unitKnown };
}

/** "148 workouts · Jan 2024 – Nov 2026" */
export function fileLine(file: ImportFile): string {
  const month = (local: string) => {
    const [year, number] = local.split("-");
    return `${MONTHS[Number(number) - 1][0].toUpperCase()}${MONTHS[Number(number) - 1].slice(1)} ${year}`;
  };
  const count = file.workouts.length === 1 ? "1 workout" : `${file.workouts.length} workouts`;
  const first = month(file.workouts[0].start);
  const last = month(file.workouts[file.workouts.length - 1].start);
  return first === last ? `${count} · ${first}` : `${count} · ${first} – ${last}`;
}

export interface ImportRequestSet {
  exerciseId: string;
  block: number;
  type: SetType;
  reps: number | null;
  kg: number | null;
  rir: number | null;
  seconds: number | null;
  metres: number | null;
  doneAt: string;
}

export interface ImportRequest {
  key: string;
  workout: {
    date: string;
    name: string | null;
    startedAt: string;
    endedAt: string | null;
    notes: string | null;
    sets: ImportRequestSet[];
  };
}

const LB = 0.45359237;
const MAX_SETS = 300;
const MAX_BLOCK = 99;

/** A local stamp as an instant, in the phone's time zone. */
export function instantOf(local: string): string {
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const within = (value: number | null, max: number) => (value != null && value <= max ? value : null);

/**
 * The workouts to send: each set on its matched exercise (sets of exercises with no match are left out, and
 * workouts left empty with them), weights in kg, distances in metres, RPE as reps in reserve. Days after `today` or
 * before 2000 are left out.
 */
export function importRequests(file: ImportFile, matches: Record<string, string | null>, unit: ImportUnit, today: string): ImportRequest[] {
  const requests: ImportRequest[] = [];
  for (const workout of file.workouts) {
    const date = workout.start.slice(0, 10);
    if (date > today || date < "2000-01-01") continue;
    const startedAt = instantOf(workout.start);
    let endedAt = workout.end ? instantOf(workout.end) : null;
    if (endedAt && (endedAt < startedAt || Date.parse(endedAt) - Date.parse(startedAt) > 86_400_000)) endedAt = null;
    const doneAt = endedAt ?? startedAt;
    const renumber = new Map<number, number>();
    const sets: ImportRequestSet[] = [];
    for (const set of workout.sets) {
      const exerciseId = matches[set.exercise];
      if (!exerciseId || sets.length >= MAX_SETS) continue;
      if (!renumber.has(set.block)) renumber.set(set.block, Math.min(renumber.size, MAX_BLOCK));
      const inKg = set.weight == null ? null : (set.weightUnit ?? unit) === "lb" ? set.weight * LB : set.weight;
      const distanceUnit = set.distanceUnit ?? (unit === "lb" ? "mi" : "km");
      const metres = set.distance == null ? null : set.distance * (distanceUnit === "km" ? 1000 : distanceUnit === "mi" ? 1609.344 : 1);
      const kg = within(inKg == null ? null : Math.round(inKg * 100) / 100, 1000);
      const reps = within(set.reps, 1000);
      const seconds = within(set.seconds, 86_400);
      const metresKept = within(metres == null ? null : Math.round(metres * 10) / 10, 1_000_000);
      if (kg == null && reps == null && seconds == null && metresKept == null) continue;
      const rir = set.rpe == null ? null : Math.min(10, Math.max(0, Math.round(10 - set.rpe)));
      sets.push({ exerciseId, block: renumber.get(set.block)!, type: set.type, reps, kg, rir, seconds, metres: metresKept, doneAt });
    }
    if (!sets.length) continue;
    requests.push({
      key: workout.key,
      workout: { date, name: workout.name?.slice(0, 80) ?? null, startedAt, endedAt, notes: workout.notes?.slice(0, 2000) ?? null, sets },
    });
  }
  return requests;
}

/** Up to `size` at a time. */
export function batches<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}
