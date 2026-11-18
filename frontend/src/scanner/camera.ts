/**
 * The device side of barcode scanning: open the back camera, read frames, report one code.
 *
 * This is the only file that touches the camera. Everything after a code is read (the lookup,
 * the food sheet, creating a food) is shared. A native shell (Capacitor) would replace
 * `startCameraScan` with a call to its barcode plugin (ML Kit) and keep the rest.
 */
import { fromScan, steadyReader, type CameraProblem } from "../lib/barcode";
import { loadDecoder } from "./decoder";

export interface CameraScan {
  stop(): void;
}

export class CameraError extends Error {
  constructor(readonly problem: CameraProblem) {
    super(problem);
  }
}

/** Frames read per second is about 1000 / this. Enough to feel instant without heating the phone. */
const FRAME_MS = 120;

/**
 * Shows the back camera in `video` and calls `onCode` once with the first code read twice in a row.
 * The camera is released when that happens, on `stop()`, or if it fails to start.
 */
export async function startCameraScan(video: HTMLVideoElement, onCode: (code: string) => void): Promise<CameraScan> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("no_camera");
  const decoderReady = loadDecoder();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new CameraError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "no_camera" : "failed");
  }

  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  try {
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute("playsinline", "");
    await video.play();
    const decoder = await decoderReady;
    const steady = steadyReader();
    const tick = async () => {
      if (stopped) return;
      let code: string | null = null;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const found = await decoder.detect(video);
          code = found.map((row) => fromScan(row.format, row.rawValue)).find((value) => value !== null) ?? null;
        } catch {
          code = null;
        }
      }
      if (stopped) return;
      const accepted = steady(code);
      if (accepted) {
        stop();
        onCode(accepted);
        return;
      }
      timer = window.setTimeout(() => void tick(), FRAME_MS);
    };
    void tick();
  } catch {
    stop();
    throw new CameraError("failed");
  }
  return { stop };
}
