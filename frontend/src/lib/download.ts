// Saving a file the app fetched (the data export) through the browser's own download.

/** The file name in a Content-Disposition header: the UTF-8 `filename*` first, then plain `filename`. */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // A broken escape: fall back to the plain name.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const name = (plain?.[2] ?? plain?.[1] ?? "").trim();
  return name || null;
}

/** Hands a file to the browser as a download. Safari on iPhone asks where to keep it. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Safari reads the file after the click returns, so the link to it stays a while.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
