/**
 * Barcode text: what the camera or the keyboard gave, made into one code the server can look up.
 * Pure, so the web scanner and a later native one share it.
 */

/** Retail formats on food packs. QR codes and the like are not products. */
export const FOOD_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
export type FoodFormat = (typeof FOOD_FORMATS)[number];

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 14;

/** The GTIN check digit for the digits before it (weights 3, 1, 3, … from the right). */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function validGtin(code: string): boolean {
  return /^\d+$/.test(code) && code.length >= MIN_LENGTH && checkDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** A UPC-E code (8 digits, a small can or bar) written out as the UPC-A code it stands for. Null if it isn't one. */
export function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [n, d1, d2, d3, d4, d5, d6, check] = code;
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${n}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${n}${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${n}${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${n}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return body + check;
}

/**
 * The code to look up from one camera read, or null to keep looking.
 * Only food formats with a correct check digit count; a misread line fails the check.
 */
export function fromScan(format: string, rawValue: string): string | null {
  const raw = rawValue.trim();
  if (!(FOOD_FORMATS as readonly string[]).includes(format)) return null;
  const code = format === "upc_e" ? upcEToUpcA(raw) : raw;
  return code && validGtin(code) ? code : null;
}

/** A typed code without spaces or dashes, or null when it isn't 8 to 14 digits. The check digit isn't
 * enforced here: the number printed under some barcodes is stored that way. */
export function fromTyped(text: string): string | null {
  const code = text.replace(/[\s-]/g, "");
  return /^\d+$/.test(code) && code.length >= MIN_LENGTH && code.length <= MAX_LENGTH ? code : null;
}

/** Grouped the way it's printed under the bars: 7 038010 009457, 0 12345 67890 5, 9638 5074. */
export function formatBarcode(code: string): string {
  if (code.length === 13) return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
  if (code.length === 12) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code[11]}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

/**
 * Accepts a code once the camera has read it `needed` times in a row. One frame can misread a
 * scuffed or curved pack; a different code starts the count again, an empty frame doesn't.
 */
export function steadyReader(needed = 2): (code: string | null) => string | null {
  let last = "";
  let count = 0;
  return (code) => {
    if (!code) return null;
    count = code === last ? count + 1 : 1;
    last = code;
    return count >= needed ? code : null;
  };
}

export type LookupStatus = "found" | "not_found" | "rate_limited" | "unavailable";

/** Why a lookup found nothing. "offline" is the app's own: the request didn't reach the server. */
export type MissStatus = Exclude<LookupStatus, "found"> | "offline";

/** The line under the code when nothing was found. */
export function missCopy(status: MissStatus): string {
  if (status === "offline") return "Couldn't reach the server. Check your connection and try again.";
  if (status === "rate_limited") return "Open Food Facts is busy. Try again in a minute, or create the food.";
  if (status === "unavailable") return "Couldn't reach Open Food Facts. Try again, or create the food.";
  return "Not in the food list or on Open Food Facts.";
}

export type CameraProblem = "denied" | "no_camera" | "failed";

export function cameraCopy(problem: CameraProblem): string {
  if (problem === "denied") return "Camera access is off. Allow it in your browser settings, or type the number.";
  if (problem === "no_camera") return "No camera found. Type the number instead.";
  return "The camera didn't start. Type the number instead.";
}
