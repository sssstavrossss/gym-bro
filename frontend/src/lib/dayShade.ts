/** How close a logged day's calories were to that day's own target. Same bands as the Progress calendar. */
export type DayShade = "future" | "none" | "notarget" | "on" | "close" | "off" | "far";

export function dayShade(
  date: string,
  today: string,
  logged: boolean,
  kcal: number | null | undefined,
  targetKcal: number | null | undefined,
): { shade: DayShade; over: boolean } {
  if (date > today) return { shade: "future", over: false };
  if (!logged || kcal == null) return { shade: "none", over: false };
  if (targetKcal == null || targetKcal <= 0) return { shade: "notarget", over: false };
  const over = kcal > targetKcal * 1.05;
  const dev = Math.abs(kcal / targetKcal - 1) * 100;
  const shade: DayShade = dev <= 5 ? "on" : dev <= 10 ? "close" : dev <= 20 ? "off" : "far";
  return { shade, over };
}
