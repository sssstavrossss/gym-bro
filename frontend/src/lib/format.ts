export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const kg = (n: number, digits = 1) => n.toFixed(digits);
export function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  if (r === 0) return (0).toFixed(digits);
  return (r < 0 ? "−" : "+") + Math.abs(r).toFixed(digits);
}
