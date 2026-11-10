/** Phone < 600, tablet 600–1,023, desktop 1,024–1,279, wide dashboard from 1,280. */
export type ScreenLayout = "phone" | "tablet" | "two" | "three";

export interface LayoutFlags {
  tablet: boolean;
  desktop: boolean;
  wide: boolean;
}

export function screenLayout(width: number): ScreenLayout {
  if (width >= 1280) return "three";
  if (width >= 1024) return "two";
  if (width >= 600) return "tablet";
  return "phone";
}

export function screenLayoutFromFlags(flags: LayoutFlags): ScreenLayout {
  if (flags.wide) return "three";
  if (flags.desktop) return "two";
  if (flags.tablet) return "tablet";
  return "phone";
}

/** Shown in the desktop sidebar. The same keys work on every width. */
export const shortcutHint = "N or / add food · Q quick add · W weight · Esc close";

export type SheetName = "weight" | "accuracy" | "chooser" | "food" | "copy" | "group";

export interface ShortcutContext {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  composing: boolean;
  /** True while the event target is an editable field. */
  typing: boolean;
  sheet: SheetName | null;
  selecting: boolean;
  /** False on setup, before the app shell is available. */
  nav: boolean;
}

export type ShortcutEffect =
  | { effect: "none" }
  | { effect: "prevent"; action: "add" | "quick" | "weight" | "close-copy" | "close-group" | "end-select" | "close-sheet" };

/**
 * N or / opens Add food, Q opens quick add, W logs weight, Esc closes.
 * Letter shortcuts never run while a field is being typed in, or while a sheet is already open.
 * Esc still closes a sheet from inside a field.
 */
export function shortcutEffect(ctx: ShortcutContext): ShortcutEffect {
  if (ctx.composing || ctx.meta || ctx.ctrl || ctx.alt) return { effect: "none" };
  if (ctx.key === "Escape") {
    if (ctx.sheet === "copy") return { effect: "prevent", action: "close-copy" };
    if (ctx.sheet === "group") return { effect: "prevent", action: "close-group" };
    if (!ctx.sheet && ctx.selecting) return { effect: "prevent", action: "end-select" };
    if (!ctx.sheet) return { effect: "none" };
    return { effect: "prevent", action: "close-sheet" };
  }
  if (ctx.typing || ctx.sheet || !ctx.nav) return { effect: "none" };
  const key = ctx.key.toLowerCase();
  if (key === "n" || key === "/") return { effect: "prevent", action: "add" };
  if (key === "q") return { effect: "prevent", action: "quick" };
  if (key === "w") return { effect: "prevent", action: "weight" };
  return { effect: "none" };
}

/** Editable fields. Buttons and links are not typing, so a shortcut may still run. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") != null) return true;
  const role = target.getAttribute("role");
  return role === "textbox" || role === "searchbox";
}
