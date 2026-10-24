export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const kg = (n: number) => n.toFixed(1);
/** Signed with a real minus sign: "−0.6", "+0.2", "0.0" */
export function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  if (r === 0) return (0).toFixed(digits);
  return (r < 0 ? "−" : "+") + Math.abs(r).toFixed(digits);
}
