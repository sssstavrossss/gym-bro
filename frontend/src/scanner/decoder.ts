import { FOOD_FORMATS } from "../lib/barcode";

/** What a decoder reports for one frame. It's the shape of the browser's own Barcode Detection API. */
export interface DetectedCode {
  format: string;
  rawValue: string;
}

export interface Decoder {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

interface DetectorClass {
  new (options: { formats: string[] }): Decoder;
  getSupportedFormats(): Promise<string[]>;
}

let loading: Promise<Decoder> | null = null;

/**
 * The browser's own barcode reader when it has one for food codes (Chrome on Android and macOS),
 * otherwise ZXing compiled to WebAssembly (Safari on iPhone has none). The WebAssembly file is
 * bundled with the app and loaded only the first time someone scans, so it never comes from a CDN.
 */
export function loadDecoder(): Promise<Decoder> {
  loading ??= pickDecoder().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function pickDecoder(): Promise<Decoder> {
  const formats = [...FOOD_FORMATS];
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      if (formats.every((format) => supported.includes(format))) return new native({ formats });
    } catch {
      // Fall through to WebAssembly.
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats });
}
