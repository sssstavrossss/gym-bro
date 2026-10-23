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
    cacheLocation: "sessionStorage";
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
    cache: { cacheLocation: "sessionStorage" },
    scopes: [config.apiScope],
  };
}

export async function loadPublicConfig(): Promise<PublicConfig> {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load sign-in settings (${response.status}).`);
  }
  return (await response.json()) as PublicConfig;
}
