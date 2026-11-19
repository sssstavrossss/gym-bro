export interface PublicConfig {
  tenantSubdomain: string;
  tenantId: string;
  spaClientId: string;
  apiClientId: string;
  apiScope: string;
}

export function isConfigured(config: PublicConfig): boolean {
  return [
    config.tenantSubdomain,
    config.tenantId,
    config.spaClientId,
    config.apiClientId,
    config.apiScope,
  ].every((value) => value.trim().length > 0);
}

export interface MsalSettings {
  auth: {
    clientId: string;
    authority: string;
    knownAuthorities: string[];
    redirectUri: string;
    postLogoutRedirectUri: string;
  };
  cache: {
    cacheLocation: "localStorage";
  };
  scopes: string[];
}

// PublicClientApplication is a public client: login uses the authorization
// code flow with PKCE, and there is no client secret in the browser.
// The redirect URI is the page origin (no path, no trailing slash) so the
// same build works on http://localhost:5173 and on the HTTPS proxy origin.
// MSAL appends /v2.0 to this authority itself. The API validates tokens
// against that same /v2.0 metadata document.
export function msalSettings(config: PublicConfig, redirectUri: string): MsalSettings {
  const host = `${config.tenantSubdomain}.ciamlogin.com`;
  return {
    auth: {
      clientId: config.spaClientId,
      authority: `https://${host}/${config.tenantId}`,
      knownAuthorities: [host],
      redirectUri,
      postLogoutRedirectUri: redirectUri,
    },
    // localStorage so a home-screen reopen can stay signed in. iOS may still
    // require an interactive sign-in after about 24 hours; see the PR notes.
    cache: { cacheLocation: "localStorage" },
    scopes: [config.apiScope],
  };
}

const CONFIG_KEY = "gymbro-public-config";

/**
 * Sign-in settings from the API. The last copy is kept so the app can still open, and MSAL still
 * find its cached account, when the phone is offline.
 */
export async function loadPublicConfig(): Promise<PublicConfig> {
  let response: Response;
  try {
    response = await fetch("/config.json", { cache: "no-store" });
  } catch (error) {
    const kept = keptConfig();
    if (kept) return kept;
    throw error;
  }
  if (!response.ok) {
    const kept = response.status >= 500 ? keptConfig() : null;
    if (kept) return kept;
    throw new Error(`Could not load sign-in settings (${response.status}).`);
  }
  const config = (await response.json()) as PublicConfig;
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* private mode */ }
  return config;
}

function keptConfig(): PublicConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as PublicConfig) : null;
  } catch {
    return null;
  }
}
