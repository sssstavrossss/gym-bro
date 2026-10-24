import { reactive, watch } from "vue";
import {
  ApiError,
  AuthRedirect,
  getProfile,
  previewTargets,
  putProfile,
  putWeighIn,
  ServerUnreachable,
  type PreviewResponse,
  type ProfileBody,
  type ProfileResponse,
  type ProfileStateResponse,
  type TargetsResponse,
  type WeightResponse,
  type WeighInResult,
} from "../api";
import { todayIso } from "../lib/dates";
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
import { boot } from "./boot";

export interface ProfileForm {
  sex: Sex | "";
  birthYear: string;
  heightCm: string;
  activity: ActivityKey | "";
  goal: Goal | "";
  rate: string;
  goalWeightKg: string;
  weighInKg: string;
  proteinSetting: MacroSetting;
  proteinGramsPerKg: string;
  fatSetting: MacroSetting;
  fatPercent: string;
  timeZone: string;
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
    activity: "",
    goal: "",
    rate: "",
    goalWeightKg: "",
    weighInKg: "",
    proteinSetting: "normal",
    proteinGramsPerKg: DEFAULT_PROTEIN.toFixed(1),
    fatSetting: "normal",
    fatPercent: String(DEFAULT_FAT),
    timeZone: deviceTimeZone(),
  };
}

function formatRate(rate: number | null): string {
  if (rate == null) return "";
  if (Math.abs(rate - 1) < 1e-6) return "1.0";
  return String(rate);
}

export function formFromProfile(profile: ProfileResponse): ProfileForm {
  return {
    sex: profile.sex,
    birthYear: String(profile.birthYear),
    heightCm: formatMeasure(profile.heightCm),
    activity: profile.activity as ActivityKey,
    goal: profile.goal,
    rate: formatRate(profile.rateKgPerWeek),
    goalWeightKg: formatMeasure(profile.goalWeightKg),
    weighInKg: "",
    proteinSetting: profile.proteinSetting as MacroSetting,
    proteinGramsPerKg: profile.proteinGramsPerKg.toFixed(1),
    fatSetting: profile.fatSetting as MacroSetting,
    fatPercent: formatMeasure(profile.fatPercent),
    timeZone: profile.timeZone,
  };
}

interface Draft {
  hasSaved: boolean;
  route: string;
  form: ProfileForm;
}

function draftKey(accountId: string): string {
  return `gymbro-draft:${accountId}`;
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
  citation: "",
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
    || !sameNumber(form.heightCm, saved.heightCm)
    || form.activity !== saved.activity
    || form.goal !== saved.goal
    || !sameRate(form.rate, saved.rateKgPerWeek)
    || !sameNumber(form.goalWeightKg, saved.goalWeightKg)
    || form.proteinSetting !== saved.proteinSetting
    || !sameNumber(form.proteinGramsPerKg, saved.proteinGramsPerKg)
    || form.fatSetting !== saved.fatSetting
    || !sameNumber(form.fatPercent, saved.fatPercent)
    || form.timeZone !== saved.timeZone;
}

function sameRate(raw: string, rate: number | null): boolean {
  if (rate == null) return raw.trim() === "";
  return sameNumber(raw, rate);
}

export function buildBody(form: ProfileForm, year = new Date().getFullYear()): { body: ProfileBody } | { error: string } {
  if (form.sex !== "male" && form.sex !== "female") return { error: "Choose male or female." };
  const birthYear = Number(form.birthYear);
  if (!/^\d{4}$/.test(form.birthYear.trim()) || birthYear < year - 100 || birthYear > year - 13) {
    return { error: "Enter a birth year that makes you between 13 and 100." };
  }
  const height = parseDecimal(form.heightCm);
  if (height == null || !atMostOneDecimal(height) || height < 100 || height > 250) {
    return { error: "Height should be between 100 and 250 cm, with at most one decimal." };
  }
  if (!form.activity || !(form.activity in ACTIVITY)) return { error: "Choose an activity level." };
  if (form.goal !== "lose" && form.goal !== "maintain" && form.goal !== "gain") {
    return { error: "Choose lose, maintain, or gain." };
  }
  let rate: number | null = null;
  if (form.goal !== "maintain") {
    const parsed = parseDecimal(form.rate);
    if (parsed == null || !RATES.some((item) => Math.abs(item - parsed) < 1e-6)) {
      return { error: "Choose a rate of 0.25, 0.5, 0.75, or 1.0 kg per week." };
    }
    rate = parsed;
  }
  const goalWeight = parseDecimal(form.goalWeightKg);
  if (goalWeight == null || !atMostOneDecimal(goalWeight) || goalWeight < 30 || goalWeight > 300) {
    return { error: "Goal weight should be between 30 and 300 kg, with one decimal." };
  }
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
  profile.hasSaved = state.profile !== null;
  if (!isDirty()) profile.preview = null;
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
    const draft = readDraft();
    if (draft) {
      profile.form = { ...emptyForm(), ...draft.form };
      profile.hasSaved = state.profile !== null;
    } else if (state.profile) {
      profile.form = formFromProfile(state.profile);
      profile.hasSaved = true;
    } else {
      profile.form = emptyForm();
      profile.hasSaved = false;
    }
    profile.error = "";
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

export async function commitProfile(): Promise<boolean> {
  const built = buildBody(profile.form);
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
  const kg = parseDecimal(profile.form.weighInKg);
  if (kg == null || !atMostOneDecimal(kg) || kg < 30 || kg > 300) {
    profile.error = "Enter a first weigh-in between 30 and 300 kg.";
    return false;
  }
  const built = buildBody(profile.form);
  if ("error" in built) {
    profile.error = built.error;
    return false;
  }
  profile.saving = true;
  try {
    await putWeighIn(todayIso(), kg, profile.form.timeZone);
    const state = await putProfile(built.body);
    applyState(state);
    profile.form.weighInKg = "";
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

export async function saveWeighIn(date: string, kg: number): Promise<WeighInResult | null> {
  if (!atMostOneDecimal(kg) || kg < 30 || kg > 300) {
    profile.error = "Weight should be between 30 and 300 kg, with one decimal.";
    return null;
  }
  try {
    const result = await putWeighIn(date, kg, profile.form.timeZone || deviceTimeZone());
    const state = await getProfile();
    profile.weight = state.weight;
    profile.targets = state.targets;
    profile.saved = state.profile;
    profile.citation = state.citation;
    profile.offline = false;
    profile.error = "";
    if (profile.hasSaved && isDirty()) await refreshPreview();
    return result;
  } catch (error) {
    fail(error);
    return null;
  }
}

let previewTimer = 0;

async function refreshPreview(): Promise<void> {
  if (!profile.hasSaved || !isDirty()) {
    profile.preview = null;
    return;
  }
  const built = buildBody(profile.form);
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

export function weightCaption(weight: WeightResponse | null): { label: string; value: string } {
  if (weight?.trendVisible && weight.trendKg != null) {
    return { label: "Trend", value: `${weight.trendKg.toFixed(2)} kg` };
  }
  if (weight?.latestKg != null) {
    return { label: "Latest weigh-in", value: `${weight.latestKg.toFixed(1)} kg` };
  }
  return { label: "Weight", value: "—" };
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
