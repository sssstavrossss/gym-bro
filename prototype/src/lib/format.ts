export const int = (n: number) => Math.round(n).toLocaleString("en-US");
/** One decimal, half away from zero (same as the app since #6: 83.25 → 83.3, never float-dependent) */
export const kg = (n: number) => (Math.sign(n) * Math.round(Math.abs(n) * 10 + 1e-9) / 10).toFixed(1);
/** Signed with a real minus sign: "−0.6", "+0.2", "0.0" */
export function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  if (r === 0) return (0).toFixed(digits);
  return (r < 0 ? "−" : "+") + Math.abs(r).toFixed(digits);
}
