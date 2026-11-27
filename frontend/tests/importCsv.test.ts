import { describe, expect, it } from "vitest";
import {
  addSeconds,
  batches,
  durationSeconds,
  fileLine,
  importRequests,
  localStamp,
  NO_WORKOUTS,
  NOT_AN_EXPORT,
  parseCsv,
  readExport,
  type ImportFile,
} from "../src/lib/importCsv";

const strong = [
  "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
  '2024-01-15 18:30:00,"Push, heavy",1h 5m,Bench Press (Barbell),W,40,10,0,0,,"Felt ""good""",',
  "2024-01-15 18:30:00,\"Push, heavy\",1h 5m,Bench Press (Barbell),1,80,8,0,0,,,8",
  "2024-01-15 18:30:00,\"Push, heavy\",1h 5m,Bench Press (Barbell),2,70,10,0,0,,,",
  "2024-01-15 18:30:00,\"Push, heavy\",1h 5m,Rest Timer,1,0,0,0,90,,,",
  "2024-01-15 18:30:00,\"Push, heavy\",1h 5m,Zercher Carry,1,60,0,20,0,,,",
  "2024-01-17 07:05:00,Run,30m,Running,1,0,0,5,1800,,,",
].join("\n");

const strongKg = [
  "Workout #;Date;Workout Name;Duration (sec);Exercise Name;Set Order;Weight (kg);Reps;RPE;Distance (meters);Seconds;Notes;Workout Notes",
  "1;2024-02-01 18:00:00;Legs;3000;Squat (Barbell);1;100,5;5;;;;;",
].join("\r\n");

const hevy = [
  "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
  '"Upper","26 Nov 2024, 18:03","26 Nov 2024, 19:10","",Bench Press (Barbell),,,0,warmup,40,10,,,',
  '"Upper","26 Nov 2024, 18:03","26 Nov 2024, 19:10","",Pull Up,0,,0,normal,,8,,,',
  '"Upper","26 Nov 2024, 18:03","26 Nov 2024, 19:10","",Dips,0,,0,normal,,12,,,',
  '"Upper","26 Nov 2024, 18:03","26 Nov 2024, 19:10","",Pull Up,0,,1,dropset,,6,,,9.5',
].join("\n");

function read(text: string): ImportFile {
  const file = readExport(text);
  if ("error" in file) throw new Error(file.error);
  return file;
}

describe("parseCsv", () => {
  it("keeps quoted commas, doubled quotes and line breaks, and finds semicolons", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\n\n1,2,3,4')).toEqual([["a", "b, c", 'say "hi"', "two\nlines"], ["1", "2", "3", "4"]]);
    expect(parseCsv("﻿a;b,c;d\r\n1;2,5;3")).toEqual([["a", "b,c", "d"], ["1", "2,5", "3"]]);
  });
});

describe("dates and durations", () => {
  it("reads the ways the apps write a start", () => {
    expect(localStamp("2024-01-15 18:30:00")).toBe("2024-01-15T18:30");
    expect(localStamp("26 Nov 2024, 18:03")).toBe("2024-11-26T18:03");
    expect(localStamp("Nov 26, 2024, 6:03 PM")).toBe("2024-11-26T18:03");
    expect(localStamp("Nov 26, 2024, 12:15 AM")).toBe("2024-11-26T00:15");
    expect(localStamp("yesterday")).toBeNull();
    expect(localStamp("2024-13-01 10:00")).toBeNull();
  });

  it("reads durations and moves a stamp past midnight", () => {
    expect(durationSeconds("1h 5m")).toBe(3900);
    expect(durationSeconds("45m")).toBe(2700);
    expect(durationSeconds("3000")).toBe(3000);
    expect(durationSeconds("")).toBeNull();
    expect(addSeconds("2024-12-31T23:30", 3600)).toBe("2025-01-01T00:30");
  });
});

describe("readExport", () => {
  it("reads a Strong export into workouts, skipping rest timers and empty rows", () => {
    const file = read(strong);
    expect(file.source).toBe("strong");
    expect(file.unitKnown).toBe(false);
    expect(file.exercises).toEqual(["Bench Press (Barbell)", "Zercher Carry", "Running"]);
    expect(file.workouts).toHaveLength(2);
    const [push, run] = file.workouts;
    expect(push).toMatchObject({ key: "2024-01-15T18:30|Push, heavy", name: "Push, heavy", start: "2024-01-15T18:30", end: "2024-01-15T19:35", notes: 'Felt "good"' });
    expect(push.sets.map((set) => [set.type, set.weight, set.reps, set.rpe, set.block])).toEqual([
      ["warmup", 40, 10, null, 0],
      ["working", 80, 8, 8, 0],
      ["working", 70, 10, null, 0],
      ["working", 60, null, null, 1],
    ]);
    expect(run.sets[0]).toMatchObject({ distance: 5, seconds: 1800, weight: null });
  });

  it("reads units from the column names and decimal commas", () => {
    const file = read(strongKg);
    expect(file.unitKnown).toBe(true);
    expect(file.workouts[0]).toMatchObject({ end: "2024-02-01T18:50" });
    expect(file.workouts[0].sets[0]).toMatchObject({ weight: 100.5, weightUnit: "kg", reps: 5 });
  });

  it("reads a Hevy export, with a superset sharing a block", () => {
    const file = read(hevy);
    expect(file.source).toBe("hevy");
    expect(file.unitKnown).toBe(true);
    const [upper] = file.workouts;
    expect(upper).toMatchObject({ start: "2024-11-26T18:03", end: "2024-11-26T19:10", notes: null });
    expect(upper.sets.map((set) => [set.exercise, set.type, set.block])).toEqual([
      ["Bench Press (Barbell)", "warmup", 0],
      ["Pull Up", "working", 1],
      ["Dips", "working", 1],
      ["Pull Up", "drop", 1],
    ]);
  });

  it("says when the file isn't an export or has nothing in it", () => {
    expect(readExport("name,calories\nApple,52")).toEqual({ error: NOT_AN_EXPORT });
    expect(readExport("")).toEqual({ error: NOT_AN_EXPORT });
    expect(readExport(strong.split("\n")[0])).toEqual({ error: NO_WORKOUTS });
  });

  it("describes the file", () => {
    expect(fileLine(read(strong))).toBe("2 workouts · Jan 2024");
    expect(fileLine(read(`${strong}\n2024-11-03 09:00:00,Legs,1h,Squat (Barbell),1,100,5,0,0,,,`))).toBe("3 workouts · Jan 2024 – Nov 2024");
  });
});

describe("importRequests", () => {
  const matches = { "Bench Press (Barbell)": "barbell-bench-press-medium-grip", Running: "run", "Zercher Carry": null };

  it("sends matched sets in kg and metres, with RPE as reps in reserve", () => {
    const [push, run] = importRequests(read(strong), matches, "lb", "2026-11-27");
    expect(push.key).toBe("2024-01-15T18:30|Push, heavy");
    expect(push.workout.date).toBe("2024-01-15");
    expect(push.workout.sets).toHaveLength(3);
    expect(push.workout.sets[1]).toMatchObject({ exerciseId: "barbell-bench-press-medium-grip", kg: 36.29, reps: 8, rir: 2, type: "working", block: 0 });
    // Every set is done when the workout ended, so it counts toward bests.
    expect(push.workout.sets.every((set) => set.doneAt === push.workout.endedAt)).toBe(true);
    expect(run.workout.sets[0]).toMatchObject({ exerciseId: "run", metres: 8046.7, seconds: 1800, kg: null });
  });

  it("leaves out unmatched exercises, days to come and workouts left empty", () => {
    expect(importRequests(read(strong), { ...matches, Running: null }, "kg", "2026-11-27")).toHaveLength(1);
    expect(importRequests(read(strong), matches, "kg", "2024-01-16")).toHaveLength(1);
    expect(importRequests(read(strong), {}, "kg", "2026-11-27")).toEqual([]);
  });

  it("keeps the file's own units over the picked one, and renumbers blocks from 0", () => {
    const [legs] = importRequests(read(strongKg), { "Squat (Barbell)": "barbell-squat" }, "lb", "2026-11-27");
    expect(legs.workout.sets[0]).toMatchObject({ kg: 100.5, block: 0 });
    const [upper] = importRequests(read(hevy), { "Pull Up": "pullups", Dips: "dips-triceps-version" }, "kg", "2026-11-27");
    expect(upper.workout.sets.map((set) => set.block)).toEqual([0, 0, 0]);
    expect(upper.workout.sets[2].rir).toBe(1);
  });

  it("sends a hundred at a time", () => {
    expect(batches(Array.from({ length: 250 }, (_, index) => index)).map((batch) => batch.length)).toEqual([100, 100, 50]);
  });
});
