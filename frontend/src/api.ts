import type { ResetSummary } from "./lib/reset";
import { accessToken } from "./auth/session";
import type { CatalogFood, OwnServing } from "./lib/foodAmount";
import type { LabelFill } from "./lib/customFood";
import type { ImportSource, RecipeImportResult } from "./lib/recipeImport";
import { kg as formatKg } from "./lib/format";
import { dispositionName } from "./lib/download";
import type { LookupStatus } from "./lib/barcode";
import type { ExerciseItem } from "./lib/exercises";
import type { Plan, PlanAnswers, PlanExercise, PlanPreview } from "./lib/plan";
import type { LiftProgress } from "./lib/strength";
import type { TimedBlockBody } from "./lib/timed";
import type { MuscleSets, VolumeTarget } from "./lib/muscleVolume";
import type { SavedSet, WorkoutRequestBody } from "./lib/workout";
import type { FatLimitsSetting, SodiumLimitSetting } from "./lib/nutrientCards";
import type { FoodUnit } from "./lib/foodUnits";
import { e2eSession } from "./auth/e2e";
import { loadPublicConfig, type PublicConfig } from "./auth/publicConfig";
import { recallAnswer, rememberAnswer } from "./offline/cache";
import { noteAnswer, noteNoAnswer } from "./state/connection";

export class ServerUnreachable extends Error {
  constructor() {
    super("Server unreachable, try again.");
    this.name = "ServerUnreachable";
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthRedirect extends Error {
  constructor() {
    super("Redirecting to sign-in.");
    this.name = "AuthRedirect";
  }
}

export interface HealthResponse {
  status: string;
  databaseReachable: boolean;
}

export interface MeResponse {
  objectId: string;
  displayName: string | null;
  email: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProfileResponse {
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  activity: string;
  goal: "lose" | "maintain" | "gain";
  rateKgPerWeek: number | null;
  goalWeightKg: number;
  proteinSetting: string;
  proteinGramsPerKg: number;
  fatSetting: string;
  fatPercent: number;
  timeZone: string;
  /** The app keeps timeZone on the device's zone. False once a zone was picked by hand. */
  timeZoneFollowsDevice?: boolean;
  /** The food country in use, as an ISO code: its foods come first in search and Describe. */
  foodCountry?: string;
  /** The food country is the time zone's. False once a country was picked by hand. */
  foodCountryFollowsZone?: boolean;
  /** Display units. Values stay in kg and cm. */
  weightUnit?: "kg" | "lb";
  heightUnit?: "cm" | "ftin";
  /** Food amounts in g and ml, or oz and fl oz. Entries stay in grams and ml. */
  foodUnit?: FoodUnit;
  /** Saturated fat and cholesterol limits on the Fats card. Display only. */
  fatLimits?: FatLimitsSetting;
  /** The sodium limit on the Carbs card and Progress. Display only. */
  sodiumLimit?: SodiumLimitSetting;
  /** Home cards and card pages switched off, on every device. Null until the app first saves them. */
  homeHidden?: string[] | null;
  macrosHidden?: string[] | null;
  progressHidden?: string[] | null;
  /** Each card's pages in swipe order, hidden ones included. Null until the app first saves one; absent from an older server. */
  macrosOrder?: string[] | null;
  progressOrder?: string[] | null;
  /** The + fan's pages, each its action ids joined by commas; empty is the default. Null until first saved. */
  fanPages?: string[] | null;
}

export type TrendState = "normal" | "low_accuracy" | "fresh_start";

export interface FreshStartResponse {
  date: string;
  previousDate: string;
  daysSincePrevious: number;
  weeksSincePrevious: number;
  recalculatePending: boolean;
}

export interface WeightResponse {
  asOf: string;
  trendKg: number | null;
  trendState: TrendState | null;
  reasons: string[];
  latestKg: number | null;
  latestDate: string | null;
  weighInsInWindow: number;
  windowDays: number;
  /** One standard deviation around today's trend, kg. */
  bandKg: number | null;
  /** Trend change over the last 2 weeks up to the latest weigh-in, kg a week. Null until 4 weigh-ins over 14 days. */
  rateKgPerWeek: number | null;
  usedKg: number | null;
  source: "trend" | "setup" | "none";
  goalReached: boolean;
  freshStart: FreshStartResponse | null;
}

export interface TargetsResponse {
  effectiveDate: string;
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  floorApplied: boolean;
  reason: string;
  reasons: string[];
  weightKg: number;
}

export interface ProfileStateResponse {
  profile: ProfileResponse | null;
  weight: WeightResponse;
  targets: TargetsResponse | null;
  citation: string;
  openFoodFacts: string;
}

export interface PreviewResponse {
  age: number;
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  floorApplied: boolean;
  weightKg: number;
  weightSource: string;
}

export interface ProfileBody {
  sex: string;
  birthYear: number;
  heightCm: number;
  activity: string;
  goal: string;
  rateKgPerWeek: number | null;
  goalWeightKg: number;
  proteinSetting: string;
  proteinGramsPerKg: number;
  fatSetting: string;
  fatPercent: number;
  timeZone: string;
}

export interface WeighInWriteResponse {
  localDate: string;
  kg: number;
  replaced: boolean;
  notice: string | null;
  trend: WeightResponse;
}

export interface ConfirmWeighInBody {
  error: string;
  code: "confirm_weigh_in";
  kg: number;
  localDate: string;
  previousTrendKg: number;
  limitKg: number;
}

export type WeighInWriteResult =
  | { saved: WeighInWriteResponse; confirm?: undefined }
  | { saved?: undefined; confirm: ConfirmWeighInBody };

export interface WeightChartPoint {
  date: string;
  trendKg: number | null;
  weighInKg: number | null;
  /** One standard deviation around the trend, kg. */
  bandKg: number | null;
  realWeighIn: boolean;
  estimated: boolean;
  gap: boolean;
  /** Between weigh-ins at most a week apart: the trend is drawn solid. */
  measured: boolean;
}

export interface WeightChartResponse {
  asOf: string;
  days: number;
  trendKg: number | null;
  trendState: TrendState | null;
  reasons: string[];
  goalReached: boolean;
  freshStart: FreshStartResponse | null;
  series: WeightChartPoint[];
}

export interface WeighInRow {
  localDate: string;
  kg: number;
  /** False only when this is the account's last weigh-in. The server decides. */
  canDelete: boolean;
}

export interface FreshStartDecisionResponse {
  accepted: boolean;
  wrote: boolean;
  targets: TargetsResponse | null;
}

export type FoodSearchRow = CatalogFood & { owned?: boolean; sourceId?: string; barcode?: string | null };

export interface FoodSearchResponse {
  query: string;
  foods: FoodSearchRow[];
  /** The spelling help's words ("kjøttdeig" for "kjottdeig") when they added foods after the ones found as typed. */
  correctedQuery?: string | null;
}

export interface RecentFood extends FoodSearchRow {
  amount: number;
  unit: string;
}

export interface RecentFoodsResponse {
  foods: RecentFood[];
}

export type OffFoodRow = Omit<FoodSearchRow, "id"> & { id: string | null };

export interface OffSearchResponse {
  query: string;
  local: FoodSearchRow[];
  openFoodFacts: {
    status: "ok" | "rate_limited" | "unavailable";
    missingKcal: number;
    results: OffFoodRow[];
  };
}

export interface LogEntryResponse {
  id: string;
  localDate: string;
  loggedAt: string;
  time: string;
  timeZone: string;
  foodId: string | null;
  groupId: string | null;
  source: string;
  grams: number | null;
  name: string;
  amount: number;
  unit: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  saturatedFat: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  nutrients?: Record<string, number | null> | null;
  idempotencyKey: string;
  deletedAt: string | null;
}

export interface LogListResponse {
  localDate: string;
  totals: {
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
    saturatedFat: number | null;
    sugars: number | null;
    fiber: number | null;
    salt: number | null;
    nutrients?: Record<string, number | null> | null;
  };
  entries: LogEntryResponse[];
}

export interface TargetsDayResponse {
  date: string;
  firstTargetDate: string | null;
  targets: TargetsResponse | null;
}

export interface DayStatusResponse {
  localDate: string;
  complete: boolean;
  fasting: boolean;
}

export interface LogDaysResponse {
  from: string;
  to: string;
  setupDate: string;
  today: string;
  firstTargetDate: string | null;
  loggedDates: string[];
}

export interface LogCreateBody {
  idempotencyKey: string;
  localDate: string;
  timeZone: string;
  name?: string;
  time?: string | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  amount?: number;
  unit?: string;
  foodId?: string | null;
  groupId?: string | null;
}

export interface LogCopyItem {
  id: string;
  idempotencyKey: string;
}

export interface LogCopyResponse {
  localDate: string;
  entries: LogEntryResponse[];
}

export interface SavedGroupItem {
  id: string;
  foodId: string | null;
  name: string;
  amount: number;
  unit: string;
  grams: number | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  quick: boolean;
  available: boolean;
}

export interface SavedGroup {
  id: string;
  name: string;
  createdAt: string;
  kcal: number;
  items: SavedGroupItem[];
}

export interface GroupLogResponse {
  localDate: string;
  time: string;
  entries: LogEntryResponse[];
  skipped: { name: string; notice: string }[];
  notice: string;
}

export interface LogPatchBody {
  name?: string;
  time?: string;
  localDate?: string;
  timeZone?: string;
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  amount?: number;
  unit?: string;
}

let configPromise: Promise<PublicConfig> | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  const e2e = e2eSession();
  if (e2e) {
    return { "X-Test-Oid": e2e.oid, "X-Test-Name": "Test User" };
  }
  configPromise ??= loadPublicConfig();
  const config = await configPromise;
  const token = await accessToken(config);
  if (!token) throw new AuthRedirect();
  return { Authorization: `Bearer ${token}` };
}

function isGateway(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  // The phone knows it has no network: don't wait on a token refresh or a fetch that can't work.
  if (deviceOffline()) {
    noteNoAnswer();
    throw new ServerUnreachable();
  }
  try {
    const headers = await authHeaders();
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });
    if (isGateway(response.status)) noteNoAnswer();
    else noteAnswer();
    return response;
  } catch (error) {
    if (error instanceof AuthRedirect) throw error;
    noteNoAnswer();
    throw new ServerUnreachable();
  }
}

/** Asks the server whether it is there, without signing in. An answer brings the app back online. */
export async function ping(): Promise<void> {
  if (deviceOffline()) return;
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (isGateway(response.status)) noteNoAnswer();
    else noteAnswer();
  } catch {
    noteNoAnswer();
  }
}

/**
 * A GET the app can show offline. Online, it asks the server and keeps the answer on the phone.
 * When the server can't be reached, it returns the last kept answer, or throws ServerUnreachable
 * when there is none.
 */
async function cachedJson<T>(path: string): Promise<T> {
  try {
    const body = await jsonOrThrow<T>(await request(path));
    void rememberAnswer(path, body);
    return body;
  } catch (error) {
    if (!(error instanceof ServerUnreachable)) throw error;
    const kept = await recallAnswer<T>(path);
    if (kept === null) throw error;
    return kept;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // The body was not JSON.
  }
  return `Request failed (${response.status}).`;
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (isGateway(response.status)) throw new ServerUnreachable();
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) throw new Error(`Health check failed (${response.status}).`);
  return (await response.json()) as HealthResponse;
}

export async function getProfile(): Promise<ProfileStateResponse> {
  return cachedJson("/api/profile");
}

export async function putProfile(body: ProfileBody): Promise<ProfileStateResponse> {
  return jsonOrThrow(await request("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export interface SettingsBody {
  timeZone?: string;
  timeZoneFollowsDevice?: boolean;
  /** An ISO code picked by hand. Send foodCountryFollowsZone false with it. */
  foodCountry?: string;
  foodCountryFollowsZone?: boolean;
  weightUnit?: "kg" | "lb";
  heightUnit?: "cm" | "ftin";
  foodUnit?: FoodUnit;
  fatLimits?: FatLimitsSetting;
  sodiumLimit?: SodiumLimitSetting;
  homeHidden?: string[];
  macrosHidden?: string[];
  progressHidden?: string[];
  macrosOrder?: string[];
  progressOrder?: string[];
  fanPages?: string[];
}

export interface SettingsResponse {
  timeZone: string;
  timeZoneFollowsDevice: boolean;
  foodCountry: string;
  foodCountryFollowsZone: boolean;
  weightUnit: "kg" | "lb";
  heightUnit: "cm" | "ftin";
  foodUnit: FoodUnit;
  fatLimits: FatLimitsSetting;
  sodiumLimit: SodiumLimitSetting;
  homeHidden: string[] | null;
  macrosHidden: string[] | null;
  progressHidden: string[] | null;
  macrosOrder?: string[] | null;
  progressOrder?: string[] | null;
  /** The + fan's pages, each its action ids joined by commas; empty is the default. Null until first saved. */
  fanPages?: string[] | null;
}

/** Display preferences. Saving one never changes the targets or adds history. */
export async function putSettings(body: SettingsBody): Promise<SettingsResponse> {
  return jsonOrThrow(await request("/api/profile/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

/** What a profile would give. `fresh` previews a fresh start: the formula at the restarted trend, as accepting one saves. */
export async function previewTargets(body: ProfileBody, fresh = false): Promise<PreviewResponse> {
  return jsonOrThrow(await request(fresh ? "/api/targets/preview?fresh=true" : "/api/targets/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function putWeighIn(date: string, kg: number, timeZone: string, confirm = false): Promise<WeighInWriteResult> {
  const response = await request(`/api/weigh-ins/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kg, timeZone, confirm }),
  });
  if (response.status === 409) {
    const body = (await response.json()) as Partial<ConfirmWeighInBody>;
    if (body.code === "confirm_weigh_in" && body.kg != null && body.localDate && body.previousTrendKg != null) {
      return {
        confirm: {
          error: body.error ?? `Is ${formatKg(body.kg)} kg right?`,
          code: "confirm_weigh_in",
          kg: body.kg,
          localDate: body.localDate,
          previousTrendKg: body.previousTrendKg,
          limitKg: body.limitKg ?? 3,
        },
      };
    }
    throw new ApiError(body.error ?? "Request failed (409).", 409);
  }
  return { saved: await jsonOrThrow<WeighInWriteResponse>(response) };
}

export async function deleteWeighIn(date: string): Promise<void> {
  const response = await request(`/api/weigh-ins/${date}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

export async function listWeighIns(): Promise<{ weighIns: WeighInRow[] }> {
  return cachedJson("/api/weigh-ins");
}

export interface ProgressDay {
  date: string;
  logged: boolean;
  kcal: number | null;
  protein: number | null;
  targetKcal: number | null;
  targetProtein: number | null;
  trendKg: number | null;
  fat?: number | null;
  carbs?: number | null;
  targetFat?: number | null;
  targetCarbs?: number | null;
  /** Grams of fibre that day. A food without a fibre figure counts as 0. Null on a day with nothing logged. */
  fiber?: number | null;
  /** One standard deviation around the trend, kg. */
  trendBandKg?: number | null;
  /** Between weigh-ins at most a week apart: the trend is drawn solid. */
  trendMeasured?: boolean;
  /** Grams of saturated fat that day. Unknown counts as 0; null on a day with nothing logged. */
  saturatedFat?: number | null;
  /** Milligrams of sodium that day: each entry's sodium, or its salt ÷ 2.5. Unknown counts as 0; null on a day with nothing logged. */
  sodiumMg?: number | null;
  /** The daily burn (TDEE) in effect that day, kcal. Null before the first target. */
  burnKcal?: number | null;
  /** The BMR in effect that day, kcal. */
  bmrKcal?: number | null;
  /** How unsure the burn is that day, kcal: it widens 60 kcal a week after it was set, up to the formula's 350. */
  burnSdKcal?: number | null;
  /** The burn was measured from intake and weight, not the formula alone. */
  burnMeasured?: boolean;
}

/** Today's burn, its spread, and the day it was last set (a recalculation or fresh start, else setup). */
export interface ProgressBurn {
  kcal: number;
  bmrKcal: number;
  sdKcal: number;
  measured: boolean;
  setOn: string;
}

export interface ProgressResponse {
  range: string;
  from: string;
  to: string;
  today: string;
  weight: {
    currentKg: number | null;
    currentDate: string | null;
    changeKg: number | null;
    trendChangeKg: number | null;
    /** Today's trend, its band, and the rate (see WeightResponse). */
    trendKg: number | null;
    bandKg: number | null;
    rateKgPerWeek: number | null;
    count: number;
    weighIns: { date: string; kg: number }[];
  };
  intake: {
    loggedDays: number;
    averageKcal: number | null;
    averageProtein: number | null;
  };
  days: ProgressDay[];
  /** Null without a target. Absent from an older server. */
  burn?: ProgressBurn | null;
}

export async function getProgress(range: string): Promise<ProgressResponse> {
  return cachedJson(`/api/progress?range=${encodeURIComponent(range)}`);
}

/** Progress → Strength (`GET /api/workouts/strength`): done workouts and sets in the range, and each lift's estimated max by day. */
export interface StrengthResponse {
  range: string;
  from: string;
  to: string;
  workouts: number;
  sets: number;
  lifts: LiftProgress[];
}

/** Kept for offline use, like Progress. */
export async function getStrength(range: string): Promise<StrengthResponse> {
  return cachedJson(`/api/workouts/strength?range=${encodeURIComponent(range)}`);
}

export interface MusclesResponse {
  /** Monday of this week. */
  from: string;
  to: string;
  workouts: number;
  /** The plan's experience; null with no plan. */
  experience: string | null;
  target: VolumeTarget;
  muscles: MuscleSets[];
}

export interface SwapOption {
  id: string;
  /** "movement": a core exercise for the same movement; "muscle": the same main muscle. */
  why: "movement" | "muscle";
}

export interface SwapsResponse {
  exerciseId: string;
  /** True when a plan's equipment and go-easy areas narrowed the list. */
  planKit: boolean;
  options: SwapOption[];
}

/** What an exercise can be swapped for in a workout. Kept for offline use. */
export async function getSwaps(exerciseId: string): Promise<SwapsResponse> {
  return cachedJson(`/api/exercises/${encodeURIComponent(exerciseId)}/swaps`);
}

/** Sets per muscle this week, for Progress → Strength. Kept for offline use, like Progress. */
export async function getMuscles(): Promise<MusclesResponse> {
  return cachedJson("/api/workouts/muscles");
}

export interface NutrientWeekResponse {
  from: string;
  to: string;
  loggedDays: number;
  /** Daily average over the logged days, by nutrient key. Empty when no day is logged. */
  average: Record<string, number | null>;
}

/** The seven days ending on `date`. */
export async function getNutrientWeek(date: string): Promise<NutrientWeekResponse> {
  return cachedJson(`/api/nutrients/week?date=${encodeURIComponent(date)}`);
}

export interface NutrientSourceFood {
  id: string;
  name: string;
  brand: string | null;
  /** g or ml: the unit of 100 behind per100. */
  basis: string;
  per100: number;
}

export interface NutrientSourcesResponse {
  nutrient: string;
  foods: NutrientSourceFood[];
}

/** Foods the user has logged, richest in `key` per 100 g first. */
export async function getNutrientSources(key: string): Promise<NutrientSourcesResponse> {
  return jsonOrThrow(await request(`/api/nutrients/${encodeURIComponent(key)}/sources`));
}

export async function getWeightChart(days = 30): Promise<WeightChartResponse> {
  return cachedJson(`/api/weight/chart?days=${days}`);
}

export async function decideFreshStart(accept: boolean): Promise<FreshStartDecisionResponse> {
  return jsonOrThrow(await request("/api/weight/fresh-start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept }),
  }));
}

/** "Keep my goal" on goal reached, saved for the latest weigh-in and goal on every device. */
export async function keepGoal(): Promise<void> {
  const response = await request("/api/weight/keep-goal", { method: "POST" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

export async function searchFoods(query: string): Promise<FoodSearchResponse> {
  return jsonOrThrow(await request(`/api/foods/search?q=${encodeURIComponent(query)}`));
}

export async function listRecentFoods(): Promise<RecentFoodsResponse> {
  return cachedJson("/api/foods/recents");
}

export async function searchOpenFoodFacts(query: string): Promise<OffSearchResponse> {
  return jsonOrThrow(await request("/api/foods/search/open-food-facts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  }));
}

export async function getFood(id: string): Promise<FoodSearchRow> {
  return cachedJson(`/api/foods/${id}`);
}

export interface BarcodeLookup {
  code: string;
  status: LookupStatus;
  food: FoodSearchRow | null;
}

/** The food for a barcode: own foods, then the catalogue, then Open Food Facts. A miss is not an error. */
export async function lookupBarcode(code: string): Promise<BarcodeLookup> {
  return jsonOrThrow(await request(`/api/foods/barcode/${encodeURIComponent(code)}`));
}

/** One food Claude found in a described meal. food is null when nothing in the catalogue fit. */
export interface DescribeItem {
  phrase: string;
  name: string;
  guessed: boolean;
  food: FoodSearchRow | null;
  amount: number;
  unit: string;
}

export interface DescribeResult {
  id: string;
  /** The words sent. Empty when only a photo was. */
  text: string;
  /** A photo was sent. The server doesn't keep it. */
  photo: boolean;
  /** With a photo: the foods Claude saw in it, "Fried egg, rice". Null without one. */
  seen: string | null;
  items: DescribeItem[];
  /** Descriptions left in the last 24 hours after this one. Null when read back without asking Claude. */
  left: number | null;
}

export interface DescribeRecent {
  id: string;
  text: string;
  photo: boolean;
  seen: string | null;
  foods: number;
  kcal: number;
  loggedAt: string;
}

export interface DescribeOverview {
  available: boolean;
  /** Descriptions a person can send in 24 hours, and how many are left. */
  limit: number;
  left: number;
  /** When one frees up, set only when none are left. */
  nextAt: string | null;
  recent: DescribeRecent[];
}

/** Whether this server can describe meals, and the ones this person logged lately. */
export async function getDescribe(): Promise<DescribeOverview> {
  return cachedJson("/api/describe");
}

/** A shrunk JPEG for Describe, base64 without the data URL prefix. */
export interface DescribePhoto {
  mediaType: string;
  data: string;
}

/** What Describe sends. */
export interface DescribeNote {
  text: string;
  photo?: DescribePhoto | null;
  /** Links an edited retry to the attempt before it. */
  retryOf?: string | null;
  /** The wall clock when it was sent, "HH:MM". It tells Claude whether "a bowl" is breakfast or a late snack. */
  time?: string | null;
}

/** Claude reads the words, the photo, or both, and picks foods from the catalogue. Nothing is logged. */
export async function describeMeal(note: DescribeNote): Promise<DescribeResult> {
  const { text, photo, retryOf, time } = note;
  return jsonOrThrow(await request("/api/describe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      ...(retryOf ? { retryOf } : {}),
      ...(photo ? { photo: { mediaType: photo.mediaType, data: photo.data } } : {}),
      ...(time ? { time } : {}),
    }),
  }));
}

/** Claude reads the nutrition table in a label photo for New food. Nothing is saved; it counts toward Describe's limit. */
export async function readLabel(photo: DescribePhoto): Promise<LabelFill & { left: number }> {
  return jsonOrThrow(await request("/api/foods/label", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo: { mediaType: photo.mediaType, data: photo.data } }),
  }));
}

/** Ingredients from a recipe link or pasted text, matched to foods for the recipe form. Nothing is saved; it counts toward Describe's limit. */
export async function importRecipe(source: ImportSource): Promise<RecipeImportResult> {
  return jsonOrThrow(await request("/api/recipes/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(source),
  }));
}

/** One exercise from "Describe a workout": a library id and the sets the words gave. Values the words lack are null. */
export interface DescribedWorkoutExercise {
  exerciseId: string;
  superset: boolean;
  sets: { kg: number | null; reps: number | null; seconds: number | null; metres: number | null }[];
}

export interface DescribedWorkout {
  exercises: DescribedWorkoutExercise[];
  /** Exercises the words named that aren't in the library. */
  unmatched: string[];
  left: number;
}

/** Claude names the exercises and sets in the words. Nothing is saved; it counts toward Describe's limit. */
export async function describeWorkout(text: string): Promise<DescribedWorkout> {
  return jsonOrThrow(await request("/api/workouts/describe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }));
}

/** Settings → Reset data: what each reset would delete. */
export async function getResetSummary(): Promise<ResetSummary> {
  return jsonOrThrow(await request("/api/reset"));
}

/** Deletes every workout and the plan. Nutrition stays. */
export async function resetTraining(): Promise<{ workouts: number; plan: boolean }> {
  return jsonOrThrow(await request("/api/reset/training", { method: "POST" }));
}

/** Deletes the food log, and with `foods` the caller's own foods, recipes and groups. Training stays. */
export async function resetNutrition(foods: boolean): Promise<{ entries: number; foods: number; recipes: number; groups: number }> {
  return jsonOrThrow(await request("/api/reset/nutrition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foods }),
  }));
}

/** A past description with the amounts it was logged with. No call to Claude. */
export async function getDescription(id: string): Promise<DescribeResult> {
  return jsonOrThrow(await request(`/api/describe/${id}`));
}

export interface DescribeLoggedItem {
  phrase: string;
  name: string;
  guessed: boolean;
  foodId: string;
  amount: number;
  unit: string;
}

/** Keeps what was added, so using this description again gives the same foods and amounts. */
export async function markDescriptionLogged(id: string, items: DescribeLoggedItem[]): Promise<void> {
  const response = await request(`/api/describe/${id}/logged`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

export interface CustomFoodBody {
  name: string;
  brand: string | null;
  barcode: string | null;
  basis: "g" | "serving";
  nutrientBasis: "per_100" | "per_serving";
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  saturatedFatPer100?: number | null;
  sugarsPer100?: number | null;
  fiberPer100?: number | null;
  saltPer100?: number | null;
  servingQuantity: number | null;
  servingLabel: string | null;
}

export async function listMyFoods(): Promise<{ foods: FoodSearchRow[] }> {
  return cachedJson("/api/foods/mine");
}

export async function createCustomFood(body: CustomFoodBody): Promise<FoodSearchRow> {
  return jsonOrThrow(await request("/api/foods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function updateCustomFood(id: string, body: CustomFoodBody): Promise<FoodSearchRow> {
  return jsonOrThrow(await request(`/api/foods/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteCustomFood(id: string): Promise<void> {
  const response = await request(`/api/foods/${id}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

/** Undo for deleting one of your own foods. Returns the food as `GET /api/foods/{id}` does. */
export async function restoreCustomFood(id: string): Promise<FoodSearchRow> {
  return jsonOrThrow(await request(`/api/foods/${id}/restore`, { method: "POST" }));
}

export async function createServing(foodId: string, body: { name: string; grams: number }): Promise<OwnServing> {
  return jsonOrThrow(await request(`/api/foods/${foodId}/servings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function updateServing(foodId: string, servingId: string, body: { name: string; grams: number }): Promise<OwnServing> {
  return jsonOrThrow(await request(`/api/foods/${foodId}/servings/${servingId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteServing(foodId: string, servingId: string): Promise<void> {
  const response = await request(`/api/foods/${foodId}/servings/${servingId}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

export async function confirmFoodBasis(id: string, basis: "g" | "ml"): Promise<FoodSearchRow> {
  return jsonOrThrow(await request(`/api/foods/${id}/basis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ basis }),
  }));
}

export async function getTargets(date: string): Promise<TargetsDayResponse> {
  return cachedJson(`/api/targets?date=${encodeURIComponent(date)}`);
}

export async function getDayStatus(date: string, timeZone: string): Promise<DayStatusResponse> {
  const query = new URLSearchParams({ date, timeZone });
  return cachedJson(`/api/day-status?${query}`);
}

export async function putDayStatus(date: string, body: { fasting: boolean; timeZone: string }): Promise<DayStatusResponse> {
  return jsonOrThrow(await request(`/api/day-status/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function listLogDays(from: string, to: string, timeZone: string): Promise<LogDaysResponse> {
  const query = new URLSearchParams({ from, to, timeZone });
  return cachedJson(`/api/log-days?${query}`);
}

export async function listLogEntries(date: string): Promise<LogListResponse> {
  return cachedJson(`/api/log-entries?date=${encodeURIComponent(date)}`);
}

export async function addLogEntry(body: LogCreateBody): Promise<LogEntryResponse> {
  return jsonOrThrow(await request("/api/log-entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function patchLogEntry(id: string, body: LogPatchBody): Promise<LogEntryResponse> {
  return jsonOrThrow(await request(`/api/log-entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function listGroups(): Promise<{ groups: SavedGroup[] }> {
  return cachedJson("/api/groups");
}

export async function createGroup(body: { name: string; entryIds: string[] }): Promise<SavedGroup> {
  return jsonOrThrow(await request("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteGroup(id: string): Promise<void> {
  const response = await request(`/api/groups/${id}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

/** Undo for deleting a group. Returns the group as `GET /api/groups/{id}` does. */
export async function restoreGroup(id: string): Promise<SavedGroup> {
  return jsonOrThrow(await request(`/api/groups/${id}/restore`, { method: "POST" }));
}

export interface RecipeIngredient {
  id: string;
  foodId: string;
  name: string;
  amount: number;
  unit: string;
  grams: number | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  /** The rest of the panel for this amount; null where the food doesn't say. */
  nutrients?: Record<string, number | null> | null;
  available: boolean;
}

export interface RecipeMacros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface Recipe {
  id: string;
  name: string;
  portions: number;
  finishedGrams: number | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  /** The whole recipe's panel past the label basics. */
  nutrients?: Record<string, number | null> | null;
  perPortion: RecipeMacros;
  perGram: RecipeMacros | null;
  notice: string;
  createdAt: string;
  updatedAt: string;
  ingredients: RecipeIngredient[];
}

export interface RecipeWrite {
  name: string;
  portions: number;
  finishedGrams: number | null;
  ingredients: { foodId: string; amount: number; unit: string }[];
}

export async function listRecipes(): Promise<{ recipes: Recipe[] }> {
  return cachedJson("/api/recipes");
}

export async function getRecipe(id: string): Promise<Recipe> {
  return cachedJson(`/api/recipes/${id}`);
}

export async function createRecipe(body: RecipeWrite): Promise<Recipe> {
  return jsonOrThrow(await request("/api/recipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function updateRecipe(id: string, body: RecipeWrite): Promise<Recipe> {
  return jsonOrThrow(await request(`/api/recipes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteRecipe(id: string): Promise<void> {
  const response = await request(`/api/recipes/${id}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

/** Undo for deleteRecipe. */
export async function restoreRecipe(id: string): Promise<Recipe> {
  return jsonOrThrow(await request(`/api/recipes/${id}/restore`, { method: "POST" }));
}

export async function logRecipe(id: string, body: { localDate: string; timeZone: string; time: string | null; idempotencyKey: string; amount: number; unit: "portion" | "g" }): Promise<LogEntryResponse> {
  return jsonOrThrow(await request(`/api/recipes/${id}/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function logGroup(id: string, body: { localDate: string; timeZone: string; time: string | null; idempotencyKey: string }): Promise<GroupLogResponse> {
  return jsonOrThrow(await request(`/api/groups/${id}/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function copyLogEntries(body: { localDate: string; timeZone: string; items: LogCopyItem[] }): Promise<LogCopyResponse> {
  return jsonOrThrow(await request("/api/log-entries/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export interface RecalculateNumbers {
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  floorApplied: boolean;
}

/** A logged day under 20% of its target. Counted unless the person leaves it out. */
export interface RecalculateLowDay {
  date: string;
  kcal: number;
  targetKcal: number | null;
  included: boolean;
}

export interface RecalculateCalendarDay {
  date: string;
  kcal: number | null;
  targetKcal: number | null;
  status: "low" | "over" | "normal" | "nolog";
  counted: boolean;
}

/** The least-squares line through the weigh-ins the period reads. */
export interface RecalculateFit {
  weighIns: number;
  first: string;
  last: string;
  rateKgPerWeek: number;
}

/** The confidence-weighted step from the old burn toward the measured one. */
export interface RecalculateStep {
  prior: number;
  measured: number;
  measuredSd: number;
  burn: number;
  gain: number;
}

export interface RecalculateReview {
  from: string;
  to: string;
  periodDays: number;
  /** The period was cut to the last 8 weeks. */
  capped: boolean;
  lastUpdate: string | null;
  /** The first weigh-in day the slope reads after the settling week, when that week falls inside the read. */
  settledFrom: string | null;
  lowDays: RecalculateLowDay[];
  calendar: RecalculateCalendarDay[];
  includedDays: number;
  measured: boolean;
  blocked: string | null;
  weighInsNeeded: number;
  averageKcal: number | null;
  fit: RecalculateFit | null;
  step: RecalculateStep | null;
  burn: number;
  burnSdKcal: number;
  proposed: RecalculateNumbers;
  formula: RecalculateNumbers;
  /** The target with every low day counted, and with every one left out. Null without low days. */
  countedKcal: number | null;
  leftOutKcal: number | null;
}

export async function getRecalculateBanner(): Promise<{ show: boolean; weekStart: string | null }> {
  return jsonOrThrow(await request("/api/recalculate/banner"));
}

export async function dismissRecalculateBanner(): Promise<void> {
  const response = await request("/api/recalculate/banner/dismiss", { method: "POST" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

export async function getRecalculate(): Promise<RecalculateReview> {
  return jsonOrThrow(await request("/api/recalculate"));
}

export async function previewRecalculate(exclude: string[], includeZero: string[]): Promise<RecalculateReview> {
  return jsonOrThrow(await request("/api/recalculate/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exclude, includeZero }),
  }));
}

/** What a recalculation saved: `recalculation_adaptive`, `recalculation_kept`, or `recalculation_formula`, the burn, and the new target. */
export interface RecalculateSaved {
  reason: string;
  burn: number;
  targets: TargetsResponse;
}

export async function saveRecalculate(exclude: string[], includeZero: string[], mode: "adaptive" | "formula"): Promise<RecalculateSaved> {
  return jsonOrThrow(await request("/api/recalculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exclude, includeZero, mode }),
  }));
}

export async function declineRecalculate(exclude: string[], includeZero: string[]): Promise<void> {
  await jsonOrThrow(await request("/api/recalculate/decline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exclude, includeZero }),
  }));
}

export interface NotificationSettings {
  configured: boolean;
  enabled: boolean;
  publicKey: string;
  types?: { id: string; enabled: boolean }[];
}

export interface TargetRecalculationDetails {
  from: string;
  to: string;
  periodDays: number;
  countedDays: number;
  lowDays: number;
  lowCounted: number;
  measured: boolean;
  weighIns: number;
  rateKgPerWeek: number | null;
  averageKcal: number | null;
  measuredBurn: number | null;
  measuredSd: number | null;
  priorBurn: number | null;
  stepPercent: number | null;
}

export interface TargetProfileChange {
  field: string;
  from: string;
  to: string;
}

export interface TargetHistoryRow {
  kind: "target" | "declined";
  date: string;
  kcal: number;
  suggestedKcal: number | null;
  protein: number;
  fat: number;
  carbs: number;
  burn: number;
  previousKcal: number | null;
  previousBurn: number | null;
  weightKg: number | null;
  reasons: string[];
  floorApplied: boolean;
  recalculation: TargetRecalculationDetails | null;
  changes: TargetProfileChange[] | null;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface TargetHistoryPage {
  rows: TargetHistoryRow[];
  total: number;
  more: boolean;
}

export interface InboxItem {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  createdAt: string;
  readAt: string | null;
}

export interface InboxResponse {
  unread: number;
  /** Unread that light the Profile tab's dot. The recalculate reminder shows on Home instead, so it isn't counted. */
  badge?: number;
  items: InboxItem[];
}

export async function getInbox(): Promise<InboxResponse> {
  return jsonOrThrow(await request("/api/notifications/inbox"));
}

export async function getUnreadCount(): Promise<{ count: number; badge?: number }> {
  return jsonOrThrow(await request("/api/notifications/inbox/unread"));
}

export async function markNotificationRead(id: number): Promise<InboxItem> {
  return jsonOrThrow(await request(`/api/notifications/inbox/${id}/read`, { method: "POST" }));
}

export async function markAllNotificationsRead(): Promise<void> {
  const response = await request("/api/notifications/inbox/read", { method: "POST" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

/** Everything the caller has entered: a zip of CSV files and one JSON file, with the name the server gave it. */
export async function getExport(): Promise<{ blob: Blob; name: string }> {
  const response = await request("/api/export");
  if (response.status === 502 || response.status === 503 || response.status === 504) throw new ServerUnreachable();
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return { blob: await response.blob(), name: dispositionName(response.headers.get("Content-Disposition")) ?? "gym-bro-export.zip" };
}

export async function getNotifications(): Promise<NotificationSettings> {
  return jsonOrThrow(await request("/api/notifications"));
}

export async function putNotifications(enabled: boolean): Promise<NotificationSettings> {
  return jsonOrThrow(await request("/api/notifications", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }));
}

export async function putNotificationType(type: string, enabled: boolean): Promise<NotificationSettings> {
  return jsonOrThrow(await request("/api/notifications", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, enabled }),
  }));
}

export async function getTargetHistory(offset = 0, limit = 20): Promise<TargetHistoryPage> {
  return jsonOrThrow(await request(`/api/profile/history?offset=${offset}&limit=${limit}`));
}

export async function savePushSubscription(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await jsonOrThrow(await request("/api/notifications/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  }));
}

export async function deleteLogEntry(id: string): Promise<void> {
  const response = await request(`/api/log-entries/${id}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

export async function restoreLogEntry(id: string): Promise<LogEntryResponse> {
  return jsonOrThrow(await request(`/api/log-entries/${id}/restore`, { method: "POST" }));
}

export interface ExercisesResponse {
  /** Changes only with a deploy that changes the library. */
  version: string;
  /** The photo folder: `{photos}/{id}/{n}.webp`. */
  photos: string;
  exercises: ExerciseItem[];
}

export interface ExerciseDetail extends ExerciseItem {
  instructions: string[];
  /** The photo folder, or null when the exercise has no photos. */
  photos: string | null;
  source: string;
  licence: string;
}

/**
 * The exercise library. The kept copy (offline/cache) is sent back as If-None-Match, so an unchanged
 * library costs a 304 and no download; with no connection the kept copy is used.
 */
export async function getExercises(): Promise<ExercisesResponse> {
  const path = "/api/exercises";
  const kept = await recallAnswer<ExercisesResponse>(path);
  try {
    const response = await request(path, kept ? { headers: { "If-None-Match": `"${kept.version}"` } } : undefined);
    if (response.status === 304 && kept) return kept;
    const body = await jsonOrThrow<ExercisesResponse>(response);
    void rememberAnswer(path, body);
    return body;
  } catch (error) {
    if (!(error instanceof ServerUnreachable) || !kept) throw error;
    return kept;
  }
}

export async function getExercise(id: string): Promise<ExerciseDetail> {
  return cachedJson(`/api/exercises/${encodeURIComponent(id)}`);
}

/** A saved workout (README → Workouts). */
export interface WorkoutResponse {
  id: string;
  kind: string;
  date: string;
  name: string | null;
  status: "done" | "skipped";
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  planWorkoutId: string | null;
  sequencePosition: number | null;
  updatedAt: string;
  sets: SavedSet[];
  /** Blocks done on the clock, with their scores (lib/timed.ts). Missing from a workout saved before they existed. */
  blocks?: TimedBlockBody[];
}

export interface PreviousSets {
  workoutId: string;
  date: string;
  sets: SavedSet[];
  /** The workout before that one with the exercise (load suggestions). Missing from copies kept before it was added. */
  earlier?: { workoutId: string; date: string; sets: SavedSet[] } | null;
  /** The best working set so far by estimated max (personal records). Missing from copies kept before it was added. */
  best?: { workoutId: string; date: string; kg: number; reps: number; rir: number | null; estimatedMax: number } | null;
}

/** Saves a whole workout under the app's own id. Sent again, it replaces the first copy. */
export async function putWorkout(id: string, body: WorkoutRequestBody): Promise<WorkoutResponse> {
  return jsonOrThrow(await request(`/api/workouts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

/** Each exercise's sets from the last workout that had it, for "Last time". Kept for offline use. */
export async function getPreviousSets(exerciseIds: readonly string[], except?: string): Promise<Record<string, PreviousSets>> {
  const query = new URLSearchParams();
  for (const id of [...exerciseIds].sort()) query.append("exercise", id);
  if (except) query.set("except", except);
  const body = await cachedJson<{ exercises: Record<string, PreviousSets> }>(`/api/workouts/previous?${query}`);
  return body.exercises;
}

/** One row of the workout history (`GET /api/workouts`). */
export interface WorkoutSummary {
  id: string;
  kind: string;
  date: string;
  name: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  planWorkoutId: string | null;
  sequencePosition: number | null;
  updatedAt: string;
  exercises: string[];
  sets: number;
  volumeKg: number;
  /** Distance covered (README → Workouts). Missing from copies kept before it was added. */
  metres?: number;
}

/** Workouts from one date through another (up to 366 days), newest first. Kept for offline use. */
export async function listWorkouts(from: string, to: string): Promise<WorkoutSummary[]> {
  const body = await cachedJson<{ workouts: WorkoutSummary[] }>(`/api/workouts?from=${from}&to=${to}`);
  return body.workouts;
}

export async function getWorkout(id: string): Promise<WorkoutResponse> {
  return cachedJson(`/api/workouts/${encodeURIComponent(id)}`);
}

export async function deleteWorkout(id: string): Promise<void> {
  const response = await request(`/api/workouts/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}

/** Your training plan, or null. Kept for offline use. */
export async function getPlan(): Promise<Plan | null> {
  const body = await cachedJson<{ plan: Plan | null }>("/api/plan");
  return body.plan;
}

/** What the answers would make, not saved. */
export async function previewPlan(answers: PlanAnswers): Promise<PlanPreview> {
  return jsonOrThrow(await request("/api/plan/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answers),
  }));
}

/** Makes your plan from the answers, or remakes it. */
export async function putPlan(answers: PlanAnswers, timeZone: string): Promise<Plan> {
  return jsonOrThrow(await request("/api/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...answers, timeZone }),
  }));
}

/** Saves one plan workout as edited by hand; the whole plan comes back. */
export async function putPlanWorkout(id: string, exercises: PlanExercise[], name?: string): Promise<Plan> {
  return jsonOrThrow(await request(`/api/plan/workouts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exercises, name }),
  }));
}

/** Ends your plan. Workouts done from it stay. */
export async function deletePlan(): Promise<void> {
  const response = await request("/api/plan", { method: "DELETE" });
  if (response.status === 204) return;
  await jsonOrThrow(response);
}
