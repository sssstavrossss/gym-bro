// Sizing a meal photo before it goes to Claude. Pure, so the device side (src/photo) stays thin.

/** The long edge a photo is shrunk to. Claude reads about this much detail; more only costs tokens and upload time. */
export const PHOTO_EDGE = 1568;

/** JPEG quality for the shrunk photo: small enough to send quickly, sharp enough to tell foods apart. */
export const PHOTO_QUALITY = 0.85;

/** The size to draw a width × height picture at so its long edge is at most `edge`. Never enlarges. */
export function fitWithin(width: number, height: number, edge = PHOTO_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The base64 part of a data URL ("data:image/jpeg;base64,...."). */
export function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? "" : dataUrl.slice(comma + 1);
}
