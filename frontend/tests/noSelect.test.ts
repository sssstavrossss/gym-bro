import { describe, expect, it } from "vitest";
import { holdNoSelect } from "../src/lib/noSelect";

function selectStart(page: EventTarget) {
  const event = new Event("selectstart", { cancelable: true });
  page.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("holdNoSelect", () => {
  it("stops a selection starting anywhere on the page while held", () => {
    const page = new EventTarget();
    expect(selectStart(page)).toBe(false);
    const release = holdNoSelect(page);
    expect(selectStart(page)).toBe(true);
    release();
    expect(selectStart(page)).toBe(false);
  });

  it("stays on until the last hold lets go, and a release twice counts once", () => {
    const page = new EventTarget();
    const menu = holdNoSelect(page);
    const drag = holdNoSelect(page);
    menu();
    menu();
    expect(selectStart(page)).toBe(true);
    drag();
    expect(selectStart(page)).toBe(false);
  });
});
