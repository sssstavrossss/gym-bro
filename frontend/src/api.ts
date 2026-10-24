import { accessToken } from "./auth/session";
import { e2eSession } from "./auth/e2e";
import { loadPublicConfig, type PublicConfig } from "./auth/publicConfig";

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
  smoothingShare: number;
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
  weightKg: number;
}

export interface ProfileStateResponse {
  profile: ProfileResponse | null;
  weight: WeightResponse;
  targets: TargetsResponse | null;
  citation: string;
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
  readingKg: number | null;
  realWeighIn: boolean;
  estimated: boolean;
  gap: boolean;
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
}

export interface FreshStartDecisionResponse {
  accepted: boolean;
  wrote: boolean;
  targets: TargetsResponse | null;
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

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    const headers = await authHeaders();
    return await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    if (error instanceof AuthRedirect) throw error;
    throw new ServerUnreachable();
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
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new ServerUnreachable();
  }
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) throw new Error(`Health check failed (${response.status}).`);
  return (await response.json()) as HealthResponse;
}

export async function getProfile(): Promise<ProfileStateResponse> {
  return jsonOrThrow(await request("/api/profile"));
}

export async function putProfile(body: ProfileBody): Promise<ProfileStateResponse> {
  return jsonOrThrow(await request("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function previewTargets(body: ProfileBody): Promise<PreviewResponse> {
  return jsonOrThrow(await request("/api/targets/preview", {
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
          error: body.error ?? `Is ${body.kg.toFixed(1)} kg right?`,
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
  return jsonOrThrow(await request("/api/weigh-ins"));
}

export async function getWeightChart(days = 30): Promise<WeightChartResponse> {
  return jsonOrThrow(await request(`/api/weight/chart?days=${days}`));
}

export async function decideFreshStart(accept: boolean): Promise<FreshStartDecisionResponse> {
  return jsonOrThrow(await request("/api/weight/fresh-start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept }),
  }));
}
