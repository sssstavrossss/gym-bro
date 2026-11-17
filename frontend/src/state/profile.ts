import { reactive, watch } from "vue";
import {
  ApiError,
  AuthRedirect,
  decideFreshStart,
  deleteWeighIn,
  getProfile,
  getWeightChart,
  listWeighIns,
  previewTargets,
  putProfile,
  putSettings,
  putWeighIn,
  ServerUnreachable,
  type PreviewResponse,
  type ProfileBody,
  type ProfileResponse,
  type ProfileStateResponse,
  type SettingsResponse,
  type TargetsResponse,
  type WeightChartResponse,
  type WeightResponse,
  type WeighInRow,
  type WeighInWriteResult,
} from "../api";
import { todayInZone } from "../lib/dates";
import {
  ACTIVITY,
  DEFAULT_FAT,
  DEFAULT_PROTEIN,
  FAT_PRESETS,
  PROTEIN_PRESETS,
  RATES,
  type ActivityKey,
  type Goal,
  type MacroSetting,
  type Sex,
} from "../lib/nutrition";
import { atMostOneDecimal, formatMeasure, parseDecimal, sameNumber } from "../lib/numbers";
import { foodUnitOf, type FoodUnit } from "../lib/foodUnits";
import { fatLimitsOf, type FatLimitsSetting, type NutrientPerson } from "../lib/nutrientCards";
import { osloYear } from "../lib/nutrients";
import {
  cmToFtIn,
  goalText,
  heightRangeError,
  heightUnitOf,
  KG_PER_LB,
  parseFtIn,
  parseWeight,
  rateText,
  weightRangeError,
  weightText,
  weightUnitOf,
  type HeightUnit,
  type WeightUnit,
} from "../lib/units";
import { isFreshStart, isLowAccuracy, profileTrendLabel } from "../lib/weightDisplay";
import { boot } from "./boot";

export interface ProfileForm {
  sex: Sex | "";
  birthYear: string;
  /** Height when it is shown in cm. */
  heightCm: string;
  /** Height when it is shown in feet and inches. */
  heightFt: string;
  heightIn: string;
  activity: ActivityKey | "";
  goal: Goal | "";
  rate: string;
  /** Goal and first weigh-in as typed, in weightUnit. */
  goalWeight: string;
  weighIn: string;
  proteinSetting: MacroSetting;
  proteinGramsPerKg: string;
  fatSetting: MacroSetting;
  fatPercent: string;
  timeZone: string;
  /** Display units. Saved as settings, not with the targets. */
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function emptyForm(): ProfileForm {
  return {
    sex: "",
    birthYear: "",
    heightCm: "",
    heightFt: "",
    heightIn: "",
    activity: "",
    goal: "",
    rate: "",
    goalWeight: "",
    weighIn: "",
    proteinSetting: "normal",
    proteinGramsPerKg: DEFAULT_PROTEIN.toFixed(1),
    fatSetting: "normal",
    fatPercent: String(DEFAULT_FAT),
    timeZone: deviceTimeZone(),
    weightUnit: "kg",
    heightUnit: "cm",
  };
}

function formatRate(rate: number | null): string {
  if (rate == null) return "";
  if (Math.abs(rate - 1) < 1e-6) return "1.0";
  return String(rate);
}

/** Feet and inches for the form. Whole inches stay bare ("5", "11.7"). */
function ftInFields(cm: number): { heightFt: string; heightIn: string } {
  const { ft, inches } = cmToFtIn(cm);
  return { heightFt: String(ft), heightIn: formatMeasure(inches) };
}

export function formFromProfile(profile: ProfileResponse): ProfileForm {
  const weightUnit = weightUnitOf(profile.weightUnit);
  return {
    sex: profile.sex,
    birthYear: String(profile.birthYear),
    heightCm: formatMeasure(profile.heightCm),
    ...ftInFields(profile.heightCm),
    activity: profile.activity as ActivityKey,
    goal: profile.goal,
    rate: formatRate(profile.rateKgPerWeek),
    goalWeight: goalText(profile.goalWeightKg, weightUnit),
    weighIn: "",
    proteinSetting: profile.proteinSetting as MacroSetting,
    proteinGramsPerKg: profile.proteinGramsPerKg.toFixed(1),
    fatSetting: profile.fatSetting as MacroSetting,
    fatPercent: formatMeasure(profile.fatPercent),
    timeZone: profile.timeZone,
    weightUnit,
    heightUnit: heightUnitOf(profile.heightUnit),
  };
}

/**
 * Moves the typed weights and height to new units. A field that still shows the saved value is re-derived from it,
 * so 80 kg doesn't drift to 80.01 kg through 176.4 lb.
 */
export function convertFormUnits(form: ProfileForm, weightUnit: WeightUnit, heightUnit: HeightUnit, saved: ProfileResponse | null): void {
  if (form.weightUnit !== weightUnit) {
    const from = form.weightUnit;
    const goalKg = saved && sameNumber(form.goalWeight, Number(goalText(saved.goalWeightKg, from)))
      ? saved.goalWeightKg
      : looseKg(form.goalWeight, from);
    if (goalKg != null) form.goalWeight = goalText(goalKg, weightUnit);
    const weighInKg = looseKg(form.weighIn, from);
    if (weighInKg != null) form.weighIn = weightText(weighInKg, weightUnit);
    form.weightUnit = weightUnit;
  }
  if (form.heightUnit !== heightUnit) {
    const cm = form.heightUnit === "cm" ? parseDecimal(form.heightCm) : parseFtIn(form.heightFt, form.heightIn);
    const exact = saved && cm != null && Math.abs(cm - saved.heightCm) < 0.2 ? saved.heightCm : cm;
    if (exact != null) {
      form.heightCm = formatMeasure(exact);
      Object.assign(form, ftInFields(exact));
    }
    form.heightUnit = heightUnit;
  }
}

function looseKg(raw: string, unit: WeightUnit): number | null {
  const value = parseDecimal(raw);
  if (value == null) return null;
  return unit === "lb" ? value * KG_PER_LB : value;
}

interface Draft {
  hasSaved: boolean;
  route: string;
  form: ProfileForm;
}

function draftKey(accountId: string): string {
  return `gymbro-draft:v2:${accountId}`;
}

export const profile = reactive({
  hasSaved: false,
  offline: false,
  saving: false,
  error: "",
  saved: null as ProfileResponse | null,
  weight: null as WeightResponse | null,
  targets: null as TargetsResponse | null,
  preview: null as PreviewResponse | null,
  proposal: null as PreviewResponse | null,
  chart: null as WeightChartResponse | null,
  weighIns: [] as WeighInRow[],
  citation: "",
  openFoodFacts: "",
  form: emptyForm(),
  saveGen: 0,
});

let hydrating = false;

function readDraft(): Draft | null {
  if (!boot.accountId) return null;
  const raw = sessionStorage.getItem(draftKey(boot.accountId));
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Draft;
    if (!draft?.form) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  if (!boot.accountId) return;
  sessionStorage.removeItem(draftKey(boot.accountId));
}

export function clearAllDrafts(): void {
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("gymbro-draft:")) keys.push(key);
  }
  keys.forEach((key) => sessionStorage.removeItem(key));
}

function persistDraft(): void {
  if (hydrating || !boot.accountId) return;
  const draft: Draft = {
    hasSaved: profile.hasSaved,
    route: window.location.pathname,
    form: { ...profile.form },
  };
  sessionStorage.setItem(draftKey(boot.accountId), JSON.stringify(draft));
}

watch(() => ({ ...profile.form, hasSaved: profile.hasSaved }), persistDraft);

export function isDirty(): boolean {
  const saved = profile.saved;
  if (!saved) return true;
  const form = profile.form;
  return form.sex !== saved.sex
    || form.birthYear !== String(saved.birthYear)
    || heightChanged(form, saved)
    || form.activity !== saved.activity
    || form.goal !== saved.goal
    || !sameRate(form.rate, saved.rateKgPerWeek)
    || !sameNumber(form.goalWeight, Number(goalText(saved.goalWeightKg, form.weightUnit)))
    || form.proteinSetting !== saved.proteinSetting
    || !sameNumber(form.proteinGramsPerKg, saved.proteinGramsPerKg)
    || form.fatSetting !== saved.fatSetting
    || !sameNumber(form.fatPercent, saved.fatPercent)
    || form.timeZone !== saved.timeZone;
}

function heightChanged(form: ProfileForm, saved: ProfileResponse): boolean {
  if (form.heightUnit === "cm") return !sameNumber(form.heightCm, saved.heightCm);
  const shown = ftInFields(saved.heightCm);
  return !sameNumber(form.heightFt, Number(shown.heightFt)) || !sameNumber(form.heightIn.trim() || "0", Number(shown.heightIn));
}

/** Centimetres typed before a switch to feet stay exact while the feet and inches still show them. */
function typedCmStillShown(form: ProfileForm): number | null {
  const typed = parseDecimal(form.heightCm);
  if (typed == null || !atMostOneDecimal(typed) || typed < 100 || typed > 250) return null;
  const shown = ftInFields(typed);
  return sameNumber(form.heightFt, Number(shown.heightFt)) && sameNumber(form.heightIn.trim() || "0", Number(shown.heightIn)) ? typed : null;
}

function sameRate(raw: string, rate: number | null): boolean {
  if (rate == null) return raw.trim() === "";
  return sameNumber(raw, rate);
}

/**
 * The profile as the API takes it: kilograms and centimetres. With `saved`, a weight or height that still shows the
 * saved value sends that value, so a round trip through pounds or feet never nudges it.
 */
export function buildBody(form: ProfileForm, saved: ProfileResponse | null = null, year = new Date().getFullYear()): { body: ProfileBody } | { error: string } {
  if (form.sex !== "male" && form.sex !== "female") return { error: "Choose male or female." };
  const birthYear = Number(form.birthYear);
  if (!/^\d{4}$/.test(form.birthYear.trim()) || birthYear < year - 100 || birthYear > year - 13) {
    return { error: "Enter a birth year that makes you between 13 and 100." };
  }
  let height: number | null;
  if (saved && !heightChanged(form, saved)) {
    height = saved.heightCm;
  } else if (form.heightUnit === "ftin") {
    height = typedCmStillShown(form) ?? parseFtIn(form.heightFt, form.heightIn);
  } else {
    const cm = parseDecimal(form.heightCm);
    height = cm != null && atMostOneDecimal(cm) && cm >= 100 && cm <= 250 ? cm : null;
  }
  if (height == null) return { error: heightRangeError(form.heightUnit) };
  if (!form.activity || !(form.activity in ACTIVITY)) return { error: "Choose an activity level." };
  if (form.goal !== "lose" && form.goal !== "maintain" && form.goal !== "gain") {
    return { error: "Choose lose, maintain, or gain." };
  }
  let rate: number | null = null;
  if (form.goal !== "maintain") {
    const parsed = parseDecimal(form.rate);
    if (parsed == null || !RATES.some((item) => Math.abs(item - parsed) < 1e-6)) {
      const rates = RATES.map((item) => rateText(item, form.weightUnit));
      return { error: `Choose a rate of ${rates.slice(0, -1).join(", ")}, or ${rates.at(-1)} ${form.weightUnit} per week.` };
    }
    rate = parsed;
  }
  const goalWeight = saved && sameNumber(form.goalWeight, Number(goalText(saved.goalWeightKg, form.weightUnit)))
    ? saved.goalWeightKg
    : parseWeight(form.goalWeight, form.weightUnit);
  if (goalWeight == null) return { error: weightRangeError("Goal weight", form.weightUnit) };
  const protein = parseDecimal(form.proteinGramsPerKg);
  if (protein == null || !proteinAllowed(form.proteinSetting, protein)) {
    return { error: "Protein should be 1.6, 2.0, or 2.4 g/kg, or an exact value from 1.2 to 3.0 in steps of 0.1." };
  }
  const fat = parseDecimal(form.fatPercent);
  if (fat == null || !fatAllowed(form.fatSetting, fat)) {
    return { error: "Fat should be 20, 25, or 30 percent, or an exact value from 15 to 40 in steps of 5." };
  }
  if (!form.timeZone.trim()) return { error: "Choose a time zone." };
  return {
    body: {
      sex: form.sex,
      birthYear,
      heightCm: height,
      activity: form.activity,
      goal: form.goal,
      rateKgPerWeek: rate,
      goalWeightKg: goalWeight,
      proteinSetting: form.proteinSetting,
      proteinGramsPerKg: protein,
      fatSetting: form.fatSetting,
      fatPercent: fat,
      timeZone: form.timeZone.trim(),
    },
  };
}

function proteinAllowed(setting: MacroSetting, grams: number): boolean {
  const preset = PROTEIN_PRESETS.find((item) => item.key === setting);
  if (preset) return Math.abs(grams - preset.value) < 1e-6;
  if (setting !== "exact") return false;
  const steps = Math.round(grams * 10);
  return grams >= 1.2 - 1e-6 && grams <= 3 + 1e-6 && Math.abs(grams * 10 - steps) < 1e-6;
}

function fatAllowed(setting: MacroSetting, percent: number): boolean {
  const preset = FAT_PRESETS.find((item) => item.key === setting);
  if (preset) return Math.abs(percent - preset.value) < 1e-6;
  if (setting !== "exact") return false;
  return percent >= 15 - 1e-6 && percent <= 40 + 1e-6 && Math.abs(percent / 5 - Math.round(percent / 5)) < 1e-6;
}

function applyState(state: ProfileStateResponse): void {
  profile.saved = state.profile;
  profile.weight = state.weight;
  profile.targets = state.targets;
  profile.citation = state.citation;
  profile.openFoodFacts = state.openFoodFacts ?? "";
  profile.hasSaved = state.profile !== null;
  if (!isDirty()) profile.preview = null;
}

async function loadChart(): Promise<void> {
  try {
    profile.chart = await getWeightChart(30);
    profile.weighIns = (await listWeighIns()).weighIns;
    profile.proposal = null;
    const weight = profile.weight;
    if (weight?.freshStart?.recalculatePending && profile.saved) {
      const built = buildBody(formFromProfile(profile.saved), profile.saved);
      if (!("error" in built)) profile.proposal = await previewTargets(built.body, true);
    }
  } catch (error) {
    if (error instanceof ServerUnreachable) profile.offline = true;
  }
}

function fail(error: unknown): void {
  if (error instanceof ServerUnreachable) {
    profile.offline = true;
    return;
  }
  if (error instanceof ApiError) {
    profile.error = error.message;
    return;
  }
  if (error instanceof AuthRedirect) return;
  profile.error = "Something went wrong.";
}

export async function loadProfile(): Promise<void> {
  hydrating = true;
  try {
    const state = await getProfile();
    profile.offline = false;
    profile.saved = state.profile;
    profile.weight = state.weight;
    profile.targets = state.targets;
    profile.citation = state.citation;
    profile.openFoodFacts = state.openFoodFacts ?? "";
    const draft = readDraft();
    if (draft) {
      profile.form = { ...emptyForm(), ...draft.form };
      profile.hasSaved = state.profile !== null;
      // Units are the account's. A draft typed before they changed elsewhere moves to them.
      if (state.profile) {
        convertFormUnits(profile.form, weightUnitOf(state.profile.weightUnit), heightUnitOf(state.profile.heightUnit), state.profile);
      }
    } else if (state.profile) {
      profile.form = formFromProfile(state.profile);
      profile.hasSaved = true;
    } else {
      profile.form = emptyForm();
      profile.hasSaved = false;
    }
    profile.error = "";
    if (state.profile) await loadChart();
  } catch (error) {
    const draft = readDraft();
    if (draft) profile.form = { ...emptyForm(), ...draft.form };
    if (error instanceof ServerUnreachable) {
      profile.offline = true;
      profile.hasSaved = draft?.hasSaved ?? false;
    } else {
      fail(error);
    }
  } finally {
    hydrating = false;
  }
}

/** Settings saved on their own (time zone, units). The form follows, so the profile never looks unsaved. */
export function applySettings(settings: SettingsResponse): void {
  const weightUnit = weightUnitOf(settings.weightUnit);
  const heightUnit = heightUnitOf(settings.heightUnit);
  if (profile.saved) {
    profile.saved = {
      ...profile.saved,
      timeZone: settings.timeZone,
      timeZoneFollowsDevice: settings.timeZoneFollowsDevice,
      weightUnit,
      heightUnit,
      foodUnit: foodUnitOf(settings.foodUnit),
      fatLimits: fatLimitsOf(settings.fatLimits),
    };
  }
  profile.form.timeZone = settings.timeZone;
  convertFormUnits(profile.form, weightUnit, heightUnit, profile.saved);
}

/**
 * Saves the display units on the account. The screen switches at once and switches back if the save fails.
 * Before there is a profile (Setup) they only change the form; saveSetup saves them. Returns an error, or "".
 */
export async function setUnits(weightUnit: WeightUnit, heightUnit: HeightUnit): Promise<string> {
  const before = { weightUnit: profile.form.weightUnit, heightUnit: profile.form.heightUnit };
  convertFormUnits(profile.form, weightUnit, heightUnit, profile.saved);
  if (!profile.saved) return "";
  try {
    applySettings(await putSettings({ weightUnit, heightUnit }));
    return "";
  } catch (error) {
    convertFormUnits(profile.form, before.weightUnit, before.heightUnit, profile.saved);
    if (error instanceof ServerUnreachable) return "Server unreachable, so the units weren't changed.";
    return error instanceof ApiError ? error.message : "Couldn't save the units.";
  }
}

/** Saves how food amounts are shown. Lists switch at once and switch back if the save fails. Returns an error, or "". */
export async function setFoodUnit(foodUnit: FoodUnit): Promise<string> {
  const saved = profile.saved;
  if (!saved) return "";
  const before = foodUnitOf(saved.foodUnit);
  profile.saved = { ...saved, foodUnit };
  try {
    applySettings(await putSettings({ foodUnit }));
    return "";
  } catch (error) {
    if (profile.saved) profile.saved = { ...profile.saved, foodUnit: before };
    if (error instanceof ServerUnreachable) return "Server unreachable, so the units weren't changed.";
    return error instanceof ApiError ? error.message : "Couldn't save the units.";
  }
}

/** Sex and age behind the nutrient references, with the kcal target of the day shown. Age 0 when unknown. */
export function nutrientPerson(kcalTarget: number | null): NutrientPerson {
  const year = profile.saved?.birthYear;
  return { sex: profile.saved?.sex ?? "", age: typeof year === "number" ? osloYear() - year : 0, kcalTarget };
}

/** Saves the Fats card limits. The card switches at once and switches back if the save fails. Returns an error, or "". */
export async function setFatLimits(fatLimits: FatLimitsSetting): Promise<string> {
  const saved = profile.saved;
  if (!saved) return "";
  const before = fatLimitsOf(saved.fatLimits);
  profile.saved = { ...saved, fatLimits };
  try {
    applySettings(await putSettings({ fatLimits }));
    return "";
  } catch (error) {
    if (profile.saved) profile.saved = { ...profile.saved, fatLimits: before };
    if (error instanceof ServerUnreachable) return "Server unreachable, so the limits weren't changed.";
    return error instanceof ApiError ? error.message : "Couldn't save the limits.";
  }
}

/** Keeps the profile on this device's zone, unless a zone was picked by hand. Quiet on failure; it retries next start. */
export async function followDeviceZone(): Promise<void> {
  const saved = profile.saved;
  if (!saved || saved.timeZoneFollowsDevice === false) return;
  const device = deviceTimeZone();
  if (!device || device === saved.timeZone) return;
  try {
    applySettings(await putSettings({ timeZone: device }));
  } catch {
    // The next start tries again.
  }
}

export async function commitProfile(): Promise<boolean> {
  const built = buildBody(profile.form, profile.saved);
  if ("error" in built) {
    profile.error = built.error;
    return false;
  }
  if (profile.saved && !isDirty()) {
    profile.error = "";
    return true;
  }
  const gen = ++profile.saveGen;
  profile.saving = true;
  try {
    const state = await putProfile(built.body);
    if (gen !== profile.saveGen) return true;
    applyState(state);
    profile.error = "";
    profile.offline = false;
    if (!isDirty()) clearDraft();
    return true;
  } catch (error) {
    if (gen === profile.saveGen) fail(error);
    return false;
  } finally {
    if (gen === profile.saveGen) profile.saving = false;
  }
}

export async function saveSetup(): Promise<boolean> {
  const unit = profile.form.weightUnit;
  const kg = parseWeight(profile.form.weighIn, unit);
  if (kg == null) {
    profile.error = weightRangeError("Your first weigh-in", unit);
    return false;
  }
  const built = buildBody(profile.form, profile.saved);
  if ("error" in built) {
    profile.error = built.error;
    return false;
  }
  profile.saving = true;
  try {
    // The server checks the date against today in the zone sent, so take today from that same zone.
    const zone = profile.form.timeZone || deviceTimeZone();
    const written = await putWeighIn(todayInZone(zone), kg, zone);
    if (written.confirm) {
      profile.error = "Enter your starting weight. A later weigh-in can be confirmed in the weight sheet.";
      return false;
    }
    const state = await putProfile(built.body);
    applyState(state);
    const units = { weightUnit: profile.form.weightUnit, heightUnit: profile.form.heightUnit };
    if (units.weightUnit !== "kg" || units.heightUnit !== "cm") applySettings(await putSettings(units));
    await loadChart();
    profile.form.weighIn = "";
    profile.error = "";
    profile.offline = false;
    clearDraft();
    return true;
  } catch (error) {
    fail(error);
    return false;
  } finally {
    profile.saving = false;
  }
}

export async function saveWeighIn(date: string, kg: number, confirm = false): Promise<WeighInWriteResult | null> {
  if (Math.abs(Math.round(kg * 100) - kg * 100) > 1e-6 || kg < 30 || kg > 300) {
    profile.error = weightRangeError("Weight", profile.form.weightUnit);
    return null;
  }
  try {
    const result = await putWeighIn(date, kg, profile.form.timeZone || deviceTimeZone(), confirm);
    if (result.confirm) {
      profile.error = "";
      return result;
    }
    const state = await getProfile();
    applyState(state);
    await loadChart();
    profile.offline = false;
    profile.error = "";
    if (profile.hasSaved && isDirty()) await refreshPreview();
    return result;
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function removeWeighIn(date: string): Promise<boolean> {
  try {
    await deleteWeighIn(date);
    const state = await getProfile();
    applyState(state);
    await loadChart();
    profile.offline = false;
    profile.error = "";
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function answerFreshStart(accept: boolean): Promise<boolean> {
  try {
    const result = await decideFreshStart(accept);
    if (result.targets) profile.targets = result.targets;
    const state = await getProfile();
    applyState(state);
    await loadChart();
    profile.offline = false;
    profile.error = "";
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

let previewTimer = 0;

async function refreshPreview(): Promise<void> {
  if (!profile.hasSaved || !isDirty()) {
    profile.preview = null;
    return;
  }
  const built = buildBody(profile.form, profile.saved);
  if ("error" in built) return;
  try {
    profile.preview = await previewTargets(built.body);
    profile.offline = false;
  } catch (error) {
    if (error instanceof ServerUnreachable) profile.offline = true;
  }
}

watch(
  () => ({ ...profile.form }),
  () => {
    if (hydrating) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void refreshPreview(), 250);
  },
);

export async function retryLoad(): Promise<void> {
  await loadProfile();
  if (profile.hasSaved && isDirty()) await refreshPreview();
}

export function weightCaption(weight: WeightResponse | null, unit: WeightUnit = "kg"): { label: string; value: string; note: string; low: boolean; fresh: boolean } {
  const low = isLowAccuracy(weight);
  const fresh = isFreshStart(weight);
  if (weight?.trendKg != null) {
    return {
      label: profileTrendLabel(weight),
      value: `${weightText(weight.trendKg, unit)} ${unit}`,
      note: low ? "low accuracy" : fresh ? "fresh start" : "",
      low,
      fresh,
    };
  }
  return { label: "Weight", value: "—", note: "", low: false, fresh: false };
}

export interface ShownTargets {
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  floorApplied: boolean;
}

export function shownTargets(): ShownTargets | null {
  if (isDirty() && profile.preview) {
    return profile.preview;
  }
  if (profile.targets) {
    return profile.targets;
  }
  return null;
}
