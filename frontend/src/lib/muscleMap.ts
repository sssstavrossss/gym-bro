// The body map: our own front and back drawing, one shape per muscle group the exercise library
// names (docs/training.md, decision 10). Each figure is drawn in a 100 × 210 box. Shapes marked
// `mirror` are drawn on the left and copied to the right; the rest sit on the middle line.

export type MuscleView = "front" | "back";
export type MuscleShade = "main" | "help";

export interface MuscleShape {
  /** The library's muscle id, or null for the parts that are not a muscle group (head, hands, knees, feet). */
  muscle: string | null;
  d: string;
  mirror: boolean;
}

const head = "M50 3.5 C55.5 3.5 58.7 7.8 58.7 13.5 C58.7 19.8 55 25 50 25 C45 25 41.3 19.8 41.3 13.5 C41.3 7.8 44.5 3.5 50 3.5 Z";
const hand = "M14.6 119 L20.4 119 Q21.6 125 19 130.5 Q16 131.5 14.4 128 Q13.4 123.5 14.6 119 Z";
const forearm = "M19.6 82.4 Q23.6 81.2 26.2 83.6 Q26.8 93 23.6 104 Q21.6 111 20.2 116.6 L15 116.6 Q13.8 106 14.8 96.5 Q16 88 19.6 82.4 Z";
const upperArm = "M21.8 57.6 Q25.4 52.6 30.6 51.6 Q31.8 60.6 29.2 70.6 Q27.4 77 24.2 80.2 Q20.4 79.6 19.6 72.6 Q19.4 64 21.8 57.6 Z";
const knee = "M33 155.6 Q38.4 158.2 44.4 155.6 L44.6 161.6 Q38.6 164 33.2 161.6 Z";
const foot = "M33.6 199.6 L42.2 199.6 Q44.6 204.6 41.6 207.4 L33 207.4 Q31.6 202.6 33.6 199.6 Z";

export const MUSCLE_SHAPES: Record<MuscleView, MuscleShape[]> = {
  front: [
    { muscle: null, d: head, mirror: false },
    { muscle: "neck", d: "M44.8 24.6 Q50 27 55.2 24.6 L56.2 33.4 Q50 35.6 43.8 33.4 Z", mirror: false },
    { muscle: "traps", d: "M43.6 29.6 L35.4 37.4 Q40.6 37.2 44.6 35.4 Z", mirror: true },
    { muscle: "shoulders", d: "M34.6 38.4 Q26 37.8 22.6 44 Q20.6 49 21.4 55.6 Q25 51 30.2 49.6 Q33 44 37 40.4 Z", mirror: true },
    { muscle: "chest", d: "M38.6 40.4 Q44 38.4 49.2 39.4 L49.2 57.8 Q42.4 61 35.6 58.2 Q32 55.6 31.8 51.4 Q34 44.2 38.6 40.4 Z", mirror: true },
    { muscle: "biceps", d: upperArm, mirror: true },
    { muscle: "forearms", d: forearm, mirror: true },
    { muscle: null, d: hand, mirror: true },
    { muscle: "abdominals", d: "M38.4 61.2 Q43.8 62.8 49.2 61.4 L49.2 72 Q43.8 73.2 38.2 72 Z", mirror: true },
    { muscle: "abdominals", d: "M38.2 73.8 Q43.8 75 49.2 73.8 L49.2 84.2 Q43.8 85.4 38.6 84.2 Z", mirror: true },
    { muscle: "abdominals", d: "M38.8 86 Q43.8 87.2 49.2 86 L49.2 96 Q44.6 99.6 41 97.2 Q39.2 92 38.8 86 Z", mirror: true },
    { muscle: "abdominals", d: "M32.2 59.6 Q34.4 61 36.6 61.8 Q36.2 77.4 39.2 95.4 Q34.6 92 32.6 84 Q30.8 72 32.2 59.6 Z", mirror: true },
    { muscle: "abductors", d: "M31.6 90.2 Q35.4 94.6 38.6 99.6 Q34.6 106.6 31.4 113.6 Q29.6 102 31.6 90.2 Z", mirror: true },
    { muscle: "quadriceps", d: "M40.2 101.2 Q35.4 107.6 32.6 116.6 Q30.2 130 31.4 144.4 Q33.4 152 37.4 153.4 Q41.6 151 43.2 146 Q44.4 136.4 43 127.4 Q40.8 113.4 40.2 101.2 Z", mirror: true },
    { muscle: "adductors", d: "M42 101.4 Q46 103 49 105.4 Q48.6 114 45.6 122 Q44.4 125.6 44 127 Q42.2 114 42 101.4 Z", mirror: true },
    { muscle: null, d: knee, mirror: true },
    { muscle: "calves", d: "M32.8 164.2 Q35.2 163 37.4 164.4 Q38.4 176 37.2 189.6 L34.8 196.4 Q31.2 184.4 31.2 174.4 Q31.2 167.4 32.8 164.2 Z", mirror: true },
    { muscle: "calves", d: "M41.2 164.4 Q43.6 163.8 44.8 165.8 Q45.8 176 43.4 190 Q40.8 182.4 40.4 172.4 Z", mirror: true },
    { muscle: null, d: foot, mirror: true },
  ],
  back: [
    { muscle: null, d: head, mirror: false },
    { muscle: "neck", d: "M45 24.4 Q50 25.8 55 24.4 L55.2 29.6 Q50 31 44.8 29.6 Z", mirror: false },
    { muscle: "traps", d: "M44.6 30.4 Q47 32.4 49.2 32.6 L49.2 64.4 Q46.8 57 43.4 51.6 Q39.8 45.6 34.4 40 Q40.4 36.6 44.6 30.4 Z", mirror: true },
    { muscle: "shoulders", d: "M33.4 40.4 Q25.6 38.6 22.4 44.4 Q20.6 49.4 21.4 55.6 Q25 51.2 29.8 50 Q31.2 45.2 33.4 40.4 Z", mirror: true },
    { muscle: "middle-back", d: "M35.2 42.4 Q39.4 46.2 42.2 51.4 Q44.6 55.6 46 60 Q41 61 36.6 57.8 Q33.2 54.6 31.6 51.4 Q32.4 46 35.2 42.4 Z", mirror: true },
    { muscle: "triceps", d: upperArm, mirror: true },
    { muscle: "forearms", d: forearm, mirror: true },
    { muscle: null, d: hand, mirror: true },
    { muscle: "lats", d: "M31.4 54 Q35 59.4 40 62.4 Q44.6 64.4 47.6 66.6 Q46.6 72.6 43.4 78.6 Q40.6 84.2 39.4 89 Q35.4 84.4 33.4 77 Q31.2 66 31.4 54 Z", mirror: true },
    { muscle: "lower-back", d: "M48.2 68.4 L49.2 69 L49.2 96.4 Q45.4 97.2 41.4 95.4 Q40.8 88.6 43.4 82.6 Q46.6 75.6 48.2 68.4 Z", mirror: true },
    { muscle: "abductors", d: "M32 89.6 Q35.6 93 38.6 97.6 Q34.6 100.4 32 104.8 Q30.6 97 32 89.6 Z", mirror: true },
    { muscle: "glutes", d: "M49.2 99 L49.2 117.8 Q45 123.8 38.6 123.4 Q32.8 121.8 31.8 114.6 Q31.4 106.6 34.4 101 Q41.4 97.4 49.2 99 Z", mirror: true },
    { muscle: "hamstrings", d: "M32.4 126.4 Q38 127.6 43.2 125.6 Q45 135.4 44 146.6 Q41.4 152.2 38 152.2 Q34.2 151.4 32.8 146.4 Q30.6 136.4 32.4 126.4 Z", mirror: true },
    { muscle: "adductors", d: "M45 124.6 Q47.4 122.8 49 121.6 Q48.4 132 45.8 140.4 Q45.6 131.6 45 124.6 Z", mirror: true },
    { muscle: null, d: knee, mirror: true },
    { muscle: "calves", d: "M32.2 164.2 Q35.2 161.6 38.6 163.2 Q40 170.4 39 180.4 Q37.4 186 35.8 188.2 Q32.4 182.4 31.6 174.4 Q31.2 168 32.2 164.2 Z", mirror: true },
    { muscle: "calves", d: "M40.4 163.2 Q43.6 162.2 45 165.2 Q46 172.4 44.2 182 Q42.4 186.2 40.8 186.4 Q40.8 176 40.4 163.2 Z", mirror: true },
    { muscle: null, d: "M34.6 190.4 L41 189.4 L41.2 197.4 L34.8 197.4 Z", mirror: true },
    { muscle: null, d: foot, mirror: true },
  ],
};

/** How each muscle is lit: main for the exercise's main muscles, help for the ones that assist. */
export function muscleShades(primary: readonly string[], secondary: readonly string[]): Map<string, MuscleShade> {
  const shades = new Map<string, MuscleShade>();
  for (const muscle of secondary) shades.set(muscle, "help");
  for (const muscle of primary) shades.set(muscle, "main");
  return shades;
}

/** The muscle groups the map can show, front and back together. */
export const MAPPED_MUSCLES: ReadonlySet<string> = new Set(
  [...MUSCLE_SHAPES.front, ...MUSCLE_SHAPES.back].flatMap((shape) => (shape.muscle ? [shape.muscle] : [])),
);
