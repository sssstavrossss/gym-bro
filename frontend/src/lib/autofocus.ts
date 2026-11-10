import type { ObjectDirective } from "vue";
import { focusField, selectField, type FocusableField } from "./focusField";

/**
 * `v-autofocus` on the one primary field of a form.
 * On mount it focuses that field and selects the whole value.
 * iOS only keeps the keyboard if `primeKeyboard()` already ran in the tap
 * that opened the form. See `focusField.ts`.
 */
export const vAutofocus: ObjectDirective<HTMLElement> = {
  mounted(el) {
    el.setAttribute("data-autofocus", "");
    const field = el as HTMLElement & FocusableField;
    el.addEventListener("focus", () => selectField(field));
    // Focus in this turn. v-model may assign the value after this hook, which
    // drops the selection, so select again once the other mount hooks have run.
    focusField(field);
    queueMicrotask(() => {
      if (typeof document !== "undefined" && document.activeElement === el) selectField(field);
    });
  },
};
