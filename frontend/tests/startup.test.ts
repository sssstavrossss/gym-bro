import { describe, expect, it } from "vitest";
import {
  authStartup,
  blockSilentSignIn,
  clearExplicitLogout,
  clearSilentSignInBlock,
  explicitLogoutKey,
  hasExplicitLogout,
  isSilentSignInStop,
  markExplicitLogout,
  silentBlockKey,
  silentSignInBlocked,
} from "../src/auth/startup";

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("authStartup", () => {
  it("uses a saved account and does not start a silent redirect", () => {
    expect(authStartup({ hasAccount: true, explicitLogout: false, redirectError: false, silentBlocked: false })).toBe("use-account");
  });

  it("asks Entra once when the app cache is empty and nobody signed out", () => {
    expect(authStartup({ hasAccount: false, explicitLogout: false, redirectError: false, silentBlocked: false })).toBe("prompt-none");
  });

  it("shows Sign in after an explicit sign-out, even if a stale account remains", () => {
    expect(authStartup({ hasAccount: true, explicitLogout: true, redirectError: false, silentBlocked: false })).toBe("show-sign-in");
  });

  it("shows Sign in after Entra says a prompt or consent is required", () => {
    expect(authStartup({ hasAccount: false, explicitLogout: false, redirectError: true, silentBlocked: false })).toBe("show-sign-in");
    expect(authStartup({ hasAccount: false, explicitLogout: false, redirectError: false, silentBlocked: true })).toBe("show-sign-in");
  });
});

describe("logout and silent-stop flags", () => {
  it("keeps the sign-out flag in the supplied storage", () => {
    const store = memory();
    markExplicitLogout(store);
    expect(hasExplicitLogout(store)).toBe(true);
    expect(store.getItem(explicitLogoutKey)).toBe("1");
    clearExplicitLogout(store);
    expect(hasExplicitLogout(store)).toBe(false);
  });

  it("blocks another silent attempt in the same browser session", () => {
    const store = memory();
    expect(silentSignInBlocked(store)).toBe(false);
    blockSilentSignIn(store);
    expect(store.getItem(silentBlockKey)).toBe("1");
    expect(silentSignInBlocked(store)).toBe(true);
    clearSilentSignInBlock(store);
    expect(silentSignInBlocked(store)).toBe(false);
  });

  it("treats login, interaction, and consent errors as a stop", () => {
    expect(isSilentSignInStop("login_required")).toBe(true);
    expect(isSilentSignInStop("interaction_required")).toBe(true);
    expect(isSilentSignInStop("consent_required")).toBe(true);
    expect(isSilentSignInStop("access_denied")).toBe(true);
    expect(isSilentSignInStop("unknown", "AADSTS50058: silent sign-in failed")).toBe(true);
    expect(isSilentSignInStop("unknown", "AADSTS65001: consent required")).toBe(true);
    expect(isSilentSignInStop("interaction_in_progress")).toBe(false);
  });
});
