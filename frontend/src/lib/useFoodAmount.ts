import { computed, ref, type Ref } from "vue";
import { ApiError, createServing, deleteServing, ServerUnreachable, updateServing, type FoodSearchRow } from "../api";
import {
  convertAmount,
  defaultAmount,
  distinctUnits,
  gramText,
  hasGramBasis,
  macroFigure,
  macrosForFood,
  normalizeUnit,
  per100Line,
  scaleStored,
  servingName,
  unitsForEntry,
  unitsForFood,
  type OwnServing,
  type UnitChoice,
} from "./foodAmount";
import { amountForRecent } from "./foodSheet";
import {
  foodAmountLabel,
  isConverted,
  quickAmountsFor,
  readField,
  servingErrorIn,
  servingLabelIn,
  shownAmountLabel,
  shownChoices,
  shownField,
  shownWeightWord,
  sizeLabel,
  typingLimits,
  type ShownAmount,
} from "./foodUnits";
import { int } from "./format";
import type { MacroAmounts } from "./macros";
import { scaleMap, valuesOf, type NutrientMap, type NutrientSource } from "./nutrients";
import { typeInto } from "./numbers";
import { afterInsertion, nextQuickInput, tookWholeSelection } from "./quickEntry";
import { toast } from "../ui";
import type { LogEntry } from "../state/log";
import { foodUnit } from "../state/units";

export interface FoodAmountOptions {
  /** A logged entry being edited: its own units and stored values, not the food's. */
  entry?: () => LogEntry | null;
  /** Shared with the sheet: a serving that can't be saved says why here. */
  formError: Ref<string>;
  /** Shared with the sheet: the server could not be reached. */
  saveError: Ref<boolean>;
  /** A serving was saved or removed: lists that hold this food can update their copy. */
  onServings?: (foodId: string, servings: OwnServing[]) => void;
}

/**
 * The amount screen's state, shared by the food sheet (log a food) and the recipe sheet
 * (add an ingredient): the food, the amount and unit as typed, the macros and nutrients of
 * that amount, and the private serving form. `FoodAmountView` draws it.
 *
 * With Food set to oz, `amountText` is typed in ounces (or fl oz) and `amountNumber` is still
 * grams (or ml), the unit the API, the preview and the macros use.
 */
export function useFoodAmount(options: FoodAmountOptions) {
  const { formError, saveError } = options;
  const entry = computed(() => options.entry?.() ?? null);
  const food = ref<FoodSearchRow | null>(null);
  const amountText = ref("100");
  const unit = ref<UnitChoice["unit"]>("g");
  /** The next key replaces the amount instead of adding to it. */
  const fresh = ref(true);
  /** The stored amount the field was filled from, so an untouched field saves it exactly. */
  const origin = ref<ShownAmount | null>(null);

  const setting = computed(() => foodUnit());

  const units = computed(() => {
    const current = entry.value;
    if (current?.source === "recipe" && (current.grams == null || current.grams <= 0)) {
      return [{ unit: "portion", label: "portion", gramsEach: null }];
    }
    const choices = current ? unitsForEntry(current) : food.value ? distinctUnits(unitsForFood(food.value), unit.value) : [];
    return shownChoices(choices, setting.value);
  });
  /** Grams or ml for the API, from what is typed (ounces with Food set to oz). */
  const amountNumber = computed(() => readField(amountText.value, unit.value, setting.value, origin.value));
  /** The food's own measure: what a serving or piece size is in. */
  const baseUnit = computed<"g" | "ml">(() => (units.value.some((item) => item.unit === "ml") && !units.value.some((item) => item.unit === "g") ? "ml" : "g"));
  const preview = computed(() => {
    if (entry.value) return scaleStored(entry.value, amountNumber.value, unit.value);
    if (food.value) return macrosForFood(food.value, amountNumber.value, unit.value);
    return { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: null as number | null };
  });
  const adding = computed<MacroAmounts>(() => ({ kcal: preview.value.kcal, p: preview.value.protein, f: preview.value.fat, c: preview.value.carbs }));
  const isCount = computed(() => unit.value !== "g" && unit.value !== "ml");
  const unitWord = computed(() => foodAmountLabel(amountNumber.value || 0, unit.value, setting.value).replace(/^[\d.]+ /, ""));
  const unitWord1 = computed(() => foodAmountLabel(1, unit.value, setting.value).replace(/^[\d.]+ /, ""));
  const gramsEach = computed(() => units.value.find((item) => item.unit === unit.value)?.gramsEach ?? null);
  /** Under an amount typed in ounces, what is saved: "= 113 g". */
  const metricLine = computed(() => (isConverted(unit.value, setting.value) ? `= ${int(amountNumber.value)} ${normalizeUnit(unit.value)}` : ""));
  /** Quick chips, in the unit typed. */
  const quickAmounts = computed(() => quickAmountsFor(unit.value, setting.value).map((value) => ({ value, label: shownAmountLabel(value, unit.value, setting.value) })));
  /** The unit the amount field is typed in, for its label: "g", "oz", "fl oz", "serving". */
  const fieldUnit = computed(() => (isConverted(unit.value, setting.value) ? shownWeightWord(unit.value, setting.value) : unit.value));
  /** The word for the serving form's weight: g or oz. */
  const servingWord = computed(() => shownWeightWord("g", setting.value));

  /** A serving or piece size in the shown unit: "150 g" or "5.3 oz". `whole` rounds grams for a total. */
  function size(value: number, whole = false): string {
    if (whole && setting.value === "g") return `${int(value)} ${baseUnit.value}`;
    return sizeLabel(value, baseUnit.value, setting.value);
  }
  const title = computed(() => food.value?.name ?? entry.value?.name ?? "");
  const per100 = computed(() => {
    if (food.value && !entry.value) return per100Line(food.value);
    const current = entry.value;
    if (!current) return "";
    if (current.source === "recipe" && current.unit === "portion") {
      const each = current.amount || 1;
      return `per portion · ${int(current.kcal / each)} kcal · P${macroFigure(current.protein / each)} F${macroFigure(current.fat / each)} C${macroFigure(current.carbs / each)}`;
    }
    if (current.grams && current.grams > 0) {
      const factor = 100 / current.grams;
      return `per 100 ${current.unit === "ml" ? "ml" : "g"} · ${int(current.kcal * factor)} kcal · P${macroFigure(current.protein * factor)} F${macroFigure(current.fat * factor)} C${macroFigure(current.carbs * factor)}`;
    }
    const each = current.amount || 1;
    return `per serving · ${int(current.kcal / each)} kcal · P${macroFigure(current.protein / each)} F${macroFigure(current.fat / each)} C${macroFigure(current.carbs / each)}`;
  });

  // Nutrients for the swipe card: per 100 (or per unit) and for the amount typed.
  const source = computed<NutrientSource | null>(() => {
    const shown = food.value;
    if (shown && !entry.value) {
      return { fat: shown.fatPer100, saturatedFat: shown.saturatedFatPer100, sugars: shown.sugarsPer100, fiber: shown.fiberPer100, salt: shown.saltPer100, nutrients: shown.nutrients };
    }
    return entry.value;
  });
  const factor = computed(() => {
    const grams = preview.value.grams;
    if (grams != null && grams > 0) return grams / 100;
    const base = entry.value?.amount || 1;
    return amountNumber.value / base;
  });
  const per100Values = computed<NutrientMap>(() => {
    const current = source.value;
    if (!current) return {};
    if (food.value && !entry.value) return valuesOf(current);
    const stored = entry.value;
    const perUnit = stored?.grams && stored.grams > 0 ? 100 / stored.grams : 1 / (stored?.amount || 1);
    return scaleMap(valuesOf(current), perUnit);
  });
  const values = computed<NutrientMap>(() => scaleMap(per100Values.value, factor.value));
  const sources = computed(() => (source.value ? [source.value] : []));

  /** Show a food, at the amount last logged when there is one, else its default. */
  function show(next: FoodSearchRow, preset?: { amount: number; unit: string }) {
    const start = preset ? amountForRecent(next, preset.amount, preset.unit) : defaultAmount(next);
    food.value = next;
    place(start.amount, start.unit);
    fresh.value = true;
    resetServingForm();
  }

  /** Fill the field from a stored amount in grams or a count; with Food set to oz it shows ounces. */
  function place(stored: string, next: string) {
    const field = shownField(stored, next, setting.value);
    unit.value = next;
    amountText.value = field.text;
    origin.value = field;
  }

  /** Show a stored amount (an entry being edited). */
  function showStored(amount: number, next: string) {
    place(String(amount), next);
    fresh.value = true;
  }

  function setUnit(next: UnitChoice) {
    if (next.unit === unit.value) return;
    if ((unit.value === "g" || unit.value === "ml") && (next.unit === "g" || next.unit === "ml")) {
      unit.value = next.unit;
      fresh.value = true;
      formError.value = "";
      return;
    }
    const current = units.value.find((item) => item.unit === unit.value);
    const amount = amountNumber.value;
    fresh.value = true;
    formError.value = "";
    place(convertAmount(amount, current, next), next.unit);
  }

  function setAmount(value: number) {
    amountText.value = String(value);
    fresh.value = false;
    formError.value = "";
  }

  function limits() {
    return typingLimits(unit.value, setting.value);
  }

  function key(pressed: string) {
    const { maxInt, decimals } = limits();
    if (fresh.value && pressed !== ".") {
      amountText.value = pressed === "⌫" ? "0" : pressed;
      fresh.value = false;
      return;
    }
    fresh.value = false;
    const next = typeInto(amountText.value === "0" && pressed !== "⌫" && pressed !== "." ? "0" : amountText.value, pressed, maxInt, decimals);
    amountText.value = next === "" ? "0" : next;
  }

  function input(event: Event) {
    const field = event.target as HTMLInputElement;
    const replace = fresh.value;
    afterInsertion(field, (raw) => {
      let text = replace && !tookWholeSelection(field) ? nextQuickInput(amountText.value, raw, true, 8) : raw;
      fresh.value = false;
      text = text.replace(",", ".").replace(/[^0-9.]/g, "");
      const { maxInt, decimals } = limits();
      const [whole, fraction] = text.split(".");
      const value = fraction === undefined ? (whole ?? "").slice(0, maxInt) : `${(whole ?? "").slice(0, maxInt)}.${fraction.slice(0, decimals)}`;
      amountText.value = value;
      if (field.value !== value) field.value = value;
    });
  }

  // Private servings ("1 slice = 35 g"), saved on the food for this person only.
  const canAddServing = computed(() => Boolean(food.value && hasGramBasis(food.value) && !entry.value));
  const ownServings = computed(() => (food.value?.servings ?? []).filter((row) => row.grams > 0 && servingName(row.name)));
  const servingOpen = ref(false);
  const servingNameText = ref("");
  const servingGrams = ref("");
  const servingEditId = ref<string | null>(null);
  const savingServing = ref(false);
  /** The serving form's weight in grams, typed in ounces with Food set to oz. */
  const servingOrigin = ref<ShownAmount | null>(null);
  const servingGramsValue = computed(() => readField(servingGrams.value, "g", setting.value, servingOrigin.value));
  const servingProblem = computed(() => servingErrorIn(servingNameText.value, servingGramsValue.value, setting.value));

  function resetServingForm() {
    servingOpen.value = false;
    servingNameText.value = "";
    servingGrams.value = "";
    servingOrigin.value = null;
    servingEditId.value = null;
  }

  function toggleServingForm() {
    const opening = !servingOpen.value;
    resetServingForm();
    servingOpen.value = opening;
  }

  function editServing(row: OwnServing) {
    servingOpen.value = true;
    servingEditId.value = row.id;
    servingNameText.value = row.name;
    const field = shownField(gramText(row.grams), "g", setting.value);
    servingGrams.value = field.text;
    servingOrigin.value = field;
  }

  function applyServings(foodId: string, servings: OwnServing[]) {
    if (food.value?.id === foodId) food.value = { ...food.value, servings };
    options.onServings?.(foodId, servings);
  }

  function remember(foodId: string, saved: OwnServing, current: OwnServing[]) {
    const next = [
      ...current.filter((row) => row.id !== saved.id && row.name.localeCompare(saved.name, undefined, { sensitivity: "accent" }) !== 0),
      saved,
    ].sort((a, b) => a.name.localeCompare(b.name));
    applyServings(foodId, next);
  }

  async function saveServing() {
    const shown = food.value;
    if (!shown || savingServing.value) return;
    const grams = servingGramsValue.value;
    const error = servingErrorIn(servingNameText.value, grams, setting.value);
    if (error) {
      formError.value = error;
      return;
    }
    const name = servingName(servingNameText.value);
    if (!name) return;
    const sameName = (shown.servings ?? []).find((row) => row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    const targetId = servingEditId.value ?? sameName?.id ?? null;
    savingServing.value = true;
    formError.value = "";
    try {
      const saved = targetId ? await updateServing(shown.id, targetId, { name, grams }) : await createServing(shown.id, { name, grams });
      remember(shown.id, saved, food.value?.id === shown.id ? food.value.servings ?? [] : shown.servings ?? []);
      unit.value = saved.name;
      amountText.value = "1";
      fresh.value = true;
      resetServingForm();
      toast(`Saved ${servingLabelIn(saved.name, saved.grams, setting.value)} for ${shown.name} · only you see it`);
    } catch (error) {
      if (error instanceof ServerUnreachable) saveError.value = true;
      else formError.value = error instanceof ApiError ? error.message : "Couldn't save that serving.";
    } finally {
      savingServing.value = false;
    }
  }

  async function restoreServing(shown: FoodSearchRow, name: string, grams: number) {
    try {
      const saved = await createServing(shown.id, { name, grams });
      remember(shown.id, saved, food.value?.id === shown.id ? food.value.servings ?? [] : shown.servings ?? []);
    } catch (error) {
      formError.value = error instanceof ApiError ? error.message : "Couldn't restore that serving.";
    }
  }

  async function dropServing(row: OwnServing) {
    const shown = food.value;
    if (!shown || savingServing.value) return;
    savingServing.value = true;
    formError.value = "";
    try {
      await deleteServing(shown.id, row.id);
      const left = (shown.servings ?? []).filter((item) => item.id !== row.id);
      applyServings(shown.id, left);
      if (servingName(unit.value)?.localeCompare(row.name, undefined, { sensitivity: "accent" }) === 0) {
        const total = Math.round(amountNumber.value * row.grams);
        place(String(total > 0 ? total : 100), "g");
        fresh.value = true;
      }
      if (servingEditId.value === row.id) resetServingForm();
      toast(`Removed serving “${row.name}”`, {
        label: "Undo",
        run: () => { void restoreServing({ ...shown, servings: left }, row.name, row.grams); },
      });
    } catch (error) {
      if (error instanceof ServerUnreachable) saveError.value = true;
      else formError.value = error instanceof ApiError ? error.message : "Couldn't remove that serving.";
    } finally {
      savingServing.value = false;
    }
  }

  return {
    food,
    entry,
    amountText,
    unit,
    fresh,
    units,
    amountNumber,
    preview,
    adding,
    isCount,
    unitWord,
    unitWord1,
    gramsEach,
    metricLine,
    fieldUnit,
    quickAmounts,
    servingWord,
    size,
    title,
    per100,
    values,
    per100Values,
    sources,
    show,
    showStored,
    setUnit,
    setAmount,
    key,
    input,
    canAddServing,
    ownServings,
    servingOpen,
    servingNameText,
    servingGrams,
    savingServing,
    servingProblem,
    resetServingForm,
    toggleServingForm,
    editServing,
    saveServing,
    dropServing,
  };
}

export type FoodAmount = ReturnType<typeof useFoodAmount>;
