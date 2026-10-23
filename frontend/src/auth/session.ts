import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";
import { msalSettings, type PublicConfig } from "./publicConfig";

let clientPromise: Promise<PublicClientApplication> | null = null;

async function clientFor(config: PublicConfig, redirectUri: string): Promise<PublicClientApplication> {
  clientPromise ??= createClient(config, redirectUri);
  return clientPromise;
}

async function createClient(config: PublicConfig, redirectUri: string): Promise<PublicClientApplication> {
  const settings = msalSettings(config, redirectUri);
  const app = new PublicClientApplication({
    auth: settings.auth,
    cache: settings.cache,
  });
  await app.initialize();

  // After Entra redirects back, this redeems the authorization code (PKCE)
  // and must run on every page load, including ones that are not a redirect.
  const result = await app.handleRedirectPromise();
  const account = result?.account ?? app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
  if (account) {
    app.setActiveAccount(account);
  }
  return app;
}

export async function currentAccount(config: PublicConfig): Promise<AccountInfo | null> {
  const app = await clientFor(config, window.location.origin);
  return app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
}

export async function signIn(config: PublicConfig): Promise<void> {
  const redirectUri = window.location.origin;
  const app = await clientFor(config, redirectUri);
  await app.loginRedirect({ scopes: msalSettings(config, redirectUri).scopes });
}

export async function signOut(config: PublicConfig): Promise<void> {
  const app = await clientFor(config, window.location.origin);
  await app.logoutRedirect({ account: app.getActiveAccount() ?? undefined });
}

export async function accessToken(config: PublicConfig): Promise<string> {
  const redirectUri = window.location.origin;
  const app = await clientFor(config, redirectUri);
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!account) {
    throw new Error("Not signed in.");
  }

  const scopes = msalSettings(config, redirectUri).scopes;
  try {
    const result = await app.acquireTokenSilent({ account, scopes });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await app.acquireTokenRedirect({ account, scopes });
      return "";
    }
    throw error;
  }
}
