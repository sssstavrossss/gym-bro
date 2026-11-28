/**
 * Stops any text selection on the page while held. iOS counts a long press as a text-selection hold, and
 * user-select on one list isn't enough: it jumps to the nearest text that can be selected (a footer button) and
 * shows its handles and magnifier. Each caller gets its own release; the guard lifts when the last one lets go.
 */
interface Page {
  addEventListener(type: string, listener: (event: Event) => void, options?: { capture?: boolean }): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: { capture?: boolean }): void;
}

const held = new Map<Page, number>();
const CAPTURE = { capture: true };

function noSelect(event: Event) {
  event.preventDefault();
}
function clearSelection() {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (selection && !selection.isCollapsed) selection.removeAllRanges();
}

export function holdNoSelect(page: Page = document): () => void {
  const count = held.get(page) ?? 0;
  held.set(page, count + 1);
  if (count === 0) {
    page.addEventListener("selectstart", noSelect, CAPTURE);
    page.addEventListener("selectionchange", clearSelection);
  }
  clearSelection();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (held.get(page) ?? 1) - 1;
    if (left > 0) {
      held.set(page, left);
      return;
    }
    held.delete(page);
    page.removeEventListener("selectstart", noSelect, CAPTURE);
    page.removeEventListener("selectionchange", clearSelection);
  };
}
