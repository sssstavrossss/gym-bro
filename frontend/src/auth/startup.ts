/**
 * Decides what to do when the SPA opens.
 *
 * The app session is the MSAL account cache (localStorage). The provider
 * session is Entra's own cookie. They are not the same. A top-level
 * prompt=none redirect asks Entra for a code only when that cookie is still
 * valid. It still uses PKCE, state, and nonce. It does not show a password
 * and it does not grant consent: if consent or a password is required, Entra
 * returns an error and the Sign in button stays.
 */
export type AuthStartup = "use-account" | "show-sign-in" | "prompt-none";

export const explicitLogoutKey = "gymbro-explicit-logout";
export const silentBlockKey = "gymbro-silent-sign-in-blocked";

const silentStopCodes = new Set([
  "login_required",
  "interaction_required",
  "consent_required",
  "access_denied",
]);

export function isSilentSignInStop(code: string, message = ""): boolean {
  const normalized = code.trim().toLowerCase();
  if (silentStopCodes.has(normalized)) return true;
  const text = message.toLowerCase();
  return text.includes("login_required")
    || text.includes("interaction_required")
    || text.includes("consent_required")
    || text.includes("aadsts50058")
    || text.includes("aadsts65001");
}

export function markExplicitLogout(storage: Storage): void {
  storage.setItem(explicitLogoutKey, "1");
}

export function clearExplicitLogout(storage: Storage): void {
  storage.removeItem(explicitLogoutKey);
}

export function hasExplicitLogout(storage: Storage): boolean {
  return storage.getItem(explicitLogoutKey) === "1";
}

export function blockSilentSignIn(storage: Storage): void {
  storage.setItem(silentBlockKey, "1");
}

export function clearSilentSignInBlock(storage: Storage): void {
  storage.removeItem(silentBlockKey);
}

export function silentSignInBlocked(storage: Storage): boolean {
  return storage.getItem(silentBlockKey) === "1";
}

export function authStartup(input: {
  hasAccount: boolean;
  explicitLogout: boolean;
  redirectError: boolean;
  silentBlocked: boolean;
}): AuthStartup {
  if (input.redirectError || input.explicitLogout || input.silentBlocked) return "show-sign-in";
  if (input.hasAccount) return "use-account";
  return "prompt-none";
}
