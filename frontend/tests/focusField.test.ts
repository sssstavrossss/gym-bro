import { expect, it } from "vitest";
import { bindFocusProxy, focusField, primeKeyboard, selectField, type FocusableField } from "../src/lib/focusField";

function field(value: string, disabled = false): FocusableField & { focused: boolean; start: number; end: number } {
  const el = {
    value,
    disabled,
    focused: false,
    start: -1,
    end: -1,
    focus() {
      el.focused = true;
    },
    setSelectionRange(start: number, end: number) {
      el.start = start;
      el.end = end;
    },
  };
  return el;
}

it("focuses a field and selects the whole value so typing replaces it", () => {
  const el = field("83.6");
  expect(focusField(el)).toBe(true);
  expect(el.focused).toBe(true);
  expect(el.start).toBe(0);
  expect(el.end).toBe(4);
});

it("selects an empty field as a zero-length range and skips a disabled field", () => {
  const empty = field("");
  selectField(empty);
  expect(empty.start).toBe(0);
  expect(empty.end).toBe(0);
  expect(focusField(field("12", true))).toBe(false);
});

it("still focuses a date field when the browser rejects a selection range", () => {
  const el: FocusableField & { focused: boolean } = {
    value: "2026-11-10",
    focused: false,
    focus() {
      el.focused = true;
    },
    setSelectionRange() {
      throw new Error("The input element's type ('date') does not support selection.");
    },
  };
  expect(focusField(el)).toBe(true);
  expect(el.focused).toBe(true);
});

it("ignores a control that cannot place a caret", () => {
  const el: FocusableField & { focused: boolean } = {
    focused: false,
    focus() {
      el.focused = true;
    },
  };
  expect(focusField(el)).toBe(true);
  expect(el.focused).toBe(true);
});

it("primes the keyboard proxy synchronously from the tap that opens a form", () => {
  let calls = 0;
  bindFocusProxy({
    focus() {
      calls += 1;
    },
  });
  primeKeyboard();
  primeKeyboard();
  expect(calls).toBe(2);
  bindFocusProxy(null);
  primeKeyboard();
  expect(calls).toBe(2);
});
