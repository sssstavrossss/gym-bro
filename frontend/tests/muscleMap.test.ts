// Vitest runs in Node. The app tsconfig only loads DOM types.
// @ts-expect-error node builtin is available when the tests run
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAPPED_MUSCLES, MUSCLE_SHAPES, muscleShades } from "../src/lib/muscleMap";

// The muscle groups free-exercise-db and our own stations name (ExerciseCatalog kebab-cases them).
function libraryMuscles(file: string): string[] {
  const data = JSON.parse(readFileSync(new URL(`../../backend/GymBro.Api/Training/${file}`, import.meta.url), "utf8"));
  const list: { primaryMuscles: string[]; secondaryMuscles: string[] }[] = Array.isArray(data) ? data : data.exercises;
  return list.flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]).map((m) => m.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
}

describe("muscle map", () => {
  it("draws every muscle group the exercise library names", () => {
    const named = new Set([...libraryMuscles("free-exercise-db.json"), ...libraryMuscles("gym-bro-exercises.json")]);
    expect(named.size).toBe(17);
    for (const muscle of named) expect(MAPPED_MUSCLES.has(muscle), muscle).toBe(true);
    expect([...MAPPED_MUSCLES].filter((m) => !named.has(m))).toEqual([]);
  });

  it("keeps every shape inside its 100 × 210 box", () => {
    for (const shape of [...MUSCLE_SHAPES.front, ...MUSCLE_SHAPES.back]) {
      const numbers = shape.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const xs = numbers.filter((_, i) => i % 2 === 0);
      const ys = numbers.filter((_, i) => i % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(100);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(210);
      // Mirrored shapes are drawn on the left half, so the copy never crosses them.
      if (shape.mirror) expect(Math.max(...xs)).toBeLessThanOrEqual(50);
    }
  });

  it("lights main muscles over helping ones", () => {
    const shades = muscleShades(["quadriceps"], ["glutes", "quadriceps"]);
    expect(shades.get("quadriceps")).toBe("main");
    expect(shades.get("glutes")).toBe("help");
    expect(shades.has("chest")).toBe(false);
  });
});
