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

export interface MeResult {
  status: number;
  body: string;
  user: MeResponse | null;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status}).`);
  }
  return (await response.json()) as HealthResponse;
}

export async function getMe(token: string): Promise<MeResult> {
  const response = await fetch("/api/me", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  if (!response.ok) {
    return { status: response.status, body, user: null };
  }
  return { status: response.status, body, user: JSON.parse(body) as MeResponse };
}
