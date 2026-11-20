/**
 * The device side of a meal photo: read the picked image, shrink it, and turn it into a JPEG to send.
 *
 * The picking itself is the browser's file input, which on a phone offers the camera and the photo library.
 * A native shell (Capacitor) would pick with its Camera plugin and pass the result through `shrinkPhoto`.
 * The photo stays on the phone until it is sent, and the server passes it to Claude without keeping it.
 */
import { base64Of, fitWithin, PHOTO_QUALITY } from "../lib/photo";

export interface MealPhoto {
  mediaType: "image/jpeg";
  /** Base64, without the data URL prefix. */
  data: string;
  /** A data URL for the thumbnail. */
  url: string;
}

export const PHOTO_UNREADABLE = "That photo couldn't be read. Try another one.";

/** Draws the picture at most PHOTO_EDGE on its long side, upright (browsers apply the camera's rotation). */
export async function shrinkPhoto(file: Blob): Promise<MealPhoto> {
  const image = await decode(file);
  try {
    const size = fitWithin(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context || !size.width) throw new Error(PHOTO_UNREADABLE);
    context.drawImage(image, 0, 0, size.width, size.height);
    const url = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
    if (!url.startsWith("data:image/jpeg")) throw new Error(PHOTO_UNREADABLE);
    return { mediaType: "image/jpeg", data: base64Of(url), url };
  } finally {
    if ("close" in image) image.close();
  }
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Some browsers can show a format (HEIC on an iPhone) that createImageBitmap can't read: try an <img>.
    }
  }
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  } catch {
    throw new Error(PHOTO_UNREADABLE);
  } finally {
    URL.revokeObjectURL(src);
  }
}
