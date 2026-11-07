import {
  AuthError,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-browser";
import {
  authStartup,
  blockSilentSignIn,
  clearExplicitLogout,
  clearSilentSignInBlock,
  hasExplicitLogout,
  isSilentSignInStop,
  markExplicitLogout,
  silentSignInBlocked,
} from "./startup";
import { msalSettings, type PublicConfig } from "./publicConfig";

type BuiltClient = {
  app: PublicClientApplication;
  redirectError: unknown;
};

let clientPromise: Promise<BuiltClient> | null = null;
let silentAttempted = false;

async function clientFor(config: PublicConfig, redirectUri: string): Promise<BuiltClient> {
  clientPromise ??= createClient(config, redirectUri);
  return clientPromise;
}

async function createClient(config: PublicConfig, redirectUri: string): Promise<BuiltClient> {
  const settings = msalSettings(config, redirectUri);
  const app = new PublicClientApplication({
    auth: settings.auth,
    cache: settings.cache,
  });
  await app.initialize();

  // After Entra redirects back, this redeems the authorization code (PKCE)
  // and must run on every page load, including ones that are not a redirect.
  let result: AuthenticationResult | null = null;
  let redirectError: unknown = null;
  try {
    result = await app.handleRedirectPromise();
  } catch (error) {
    redirectError = error;
    if (isRedirectStop(error)) blockSilentSignIn(sessionStorage);
  }
  const account = result?.account ?? app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
  if (account) app.setActiveAccount(account);
  return { app, redirectError };
}

function isRedirectStop(error: unknown): boolean {
  if (!(error instanceof AuthError)) return true;
  return isSilentSignInStop(error.errorCode, error.errorMessage || error.message);
}

export async function currentAccount(config: PublicConfig): Promise<AccountInfo | null> {
  const redirectUri = window.location.origin;
  const { app, redirectError } = await clientFor(config, redirectUri);
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
  const decision = authStartup({
    hasAccount: account !== null,
    explicitLogout: hasExplicitLogout(localStorage),
    redirectError: redirectError !== null,
    silentBlocked: silentSignInBlocked(sessionStorage),
  });
  if (decision === "use-account") return account;
  if (decision === "prompt-none" && !silentAttempted) {
    silentAttempted = true;
    try {
      await app.loginRedirect({
        scopes: msalSettings(config, redirectUri).scopes,
        prompt: "none",
      });
    } catch {
      blockSilentSignIn(sessionStorage);
    }
  }
  return null;
}

export async function signIn(config: PublicConfig): Promise<void> {
  clearExplicitLogout(localStorage);
  clearSilentSignInBlock(sessionStorage);
  const redirectUri = window.location.origin;
  const { app } = await clientFor(config, redirectUri);
  await app.loginRedirect({ scopes: msalSettings(config, redirectUri).scopes });
}

export async function signOut(config: PublicConfig): Promise<void> {
  markExplicitLogout(localStorage);
  const { app } = await clientFor(config, window.location.origin);
  await app.logoutRedirect({ account: app.getActiveAccount() ?? undefined });
}

export async function accessToken(config: PublicConfig): Promise<string> {
  const redirectUri = window.location.origin;
  const { app } = await clientFor(config, redirectUri);
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
