import { afterEach, describe, expect, it, vi } from "vitest";
import { pendingKey, readPending, reconcileHidden, writePending } from "../src/lib/hiddenSync";

function stubStorage(values: Record<string, string> = {}, broken = false) {
  const store = new Map(Object.entries(values));
  const guard = () => { if (broken) throw new Error("denied"); };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { guard(); return store.get(key) ?? null; },
    setItem: (key: string, value: string) => { guard(); store.set(key, value); },
    removeItem: (key: string) => { guard(); store.delete(key); },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("hidden lists that follow the account", () => {
  it("takes the account's list over this device's", () => {
    expect(reconcileHidden(["foods"], ["progress"], false)).toEqual({ use: ["foods"], push: false });
    expect(reconcileHidden([], ["progress"], false)).toEqual({ use: [], push: false });
  });

  it("gives a server that never had the list this device's choice", () => {
    expect(reconcileHidden(null, ["progress"], false)).toEqual({ use: ["progress"], push: true });
    expect(reconcileHidden(undefined, ["progress"], false)).toEqual({ use: ["progress"], push: true });
    // Nothing hidden here either: nothing to send.
    expect(reconcileHidden(null, [], false)).toEqual({ use: [], push: false });
  });

  it("keeps and sends a change the server doesn't have yet", () => {
    expect(reconcileHidden(["foods"], ["macros"], true)).toEqual({ use: ["macros"], push: true });
    expect(reconcileHidden(["foods"], [], true)).toEqual({ use: [], push: true });
  });

  it("keeps pending lists per account and ignores junk", () => {
    const store = stubStorage({ [pendingKey("b")]: JSON.stringify(["progress", "nope", "home"]) });
    writePending("a", ["macros"]);
    expect(readPending("a")).toEqual(["macros"]);
    expect(readPending("b")).toEqual(["home", "progress"]);
    writePending("a", []);
    expect(store.has(pendingKey("a"))).toBe(false);
  });

  it("treats broken storage as nothing pending", () => {
    stubStorage({}, true);
    expect(readPending("a")).toEqual([]);
    expect(() => writePending("a", ["home"])).not.toThrow();
  });
});
