import { describe, expect, it } from "vitest";
import { isConfigured, msalSettings, type PublicConfig } from "../src/auth/publicConfig";

const config: PublicConfig = {
  tenantSubdomain: "contoso",
  tenantId: "tenant-id",
  spaClientId: "spa-id",
  apiClientId: "api-id",
  apiScope: "api://api-id/access_as_user",
};

describe("msalSettings", () => {
  it("uses the CIAM authority and the scope from runtime config", () => {
    const settings = msalSettings(config, "https://gym.example");

    expect(settings.auth.clientId).toBe("spa-id");
    expect(settings.auth.authority).toBe("https://contoso.ciamlogin.com/tenant-id");
    expect(settings.auth.knownAuthorities).toEqual(["contoso.ciamlogin.com"]);
    expect(settings.auth.redirectUri).toBe("https://gym.example");
    expect(settings.auth.postLogoutRedirectUri).toBe("https://gym.example");
    expect(settings.cache.cacheLocation).toBe("sessionStorage");
    expect(settings.scopes).toEqual(["api://api-id/access_as_user"]);
  });
});

describe("isConfigured", () => {
  it("requires every Entra value", () => {
    expect(isConfigured(config)).toBe(true);
    expect(isConfigured({ ...config, spaClientId: "  " })).toBe(false);
  });
});
