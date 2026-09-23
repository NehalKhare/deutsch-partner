import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDevicePreference } from "@/lib/settings/device";

/**
 * Preferences that live on the device.
 *
 * The properties that matter: a value survives a round trip, garbage and
 * absence both read as the fallback, and a browser that refuses storage still
 * gets a working toggle for the visit. Storage is stubbed because the
 * environment's own localStorage cannot be relied on to exist at all.
 */

type Store = Map<string, string>;

function stubStorage(): Store {
  const store: Store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

function brokenStorage(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    },
  });
}

const COLOURS = ["red", "blue"] as const;

describe("a device preference", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("reads the fallback before anything was chosen", () => {
    const pref = createDevicePreference("test.colour", COLOURS, "red");

    expect(pref.read()).toBe("red");
  });

  it("survives a round trip", () => {
    const pref = createDevicePreference("test.colour", COLOURS, "red");

    pref.write("blue");

    expect(pref.read()).toBe("blue");
    expect(window.localStorage.getItem("test.colour")).toBe("blue");
  });

  it("treats stored garbage as nothing rather than as a value", () => {
    // A preference that cannot be understood must not wedge a page.
    window.localStorage.setItem("test.colour", "chartreuse");
    const pref = createDevicePreference("test.colour", COLOURS, "red");

    expect(pref.read()).toBe("red");
  });

  it("tells its subscribers about a write, once each", () => {
    const pref = createDevicePreference("test.colour", COLOURS, "red");
    const heard = vi.fn();
    const unsubscribe = pref.subscribe(heard);

    pref.write("blue");
    expect(heard).toHaveBeenCalledTimes(1);

    unsubscribe();
    pref.write("red");
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("when storage refuses", () => {
  beforeEach(() => {
    brokenStorage();
  });

  it("still reads the fallback rather than throwing", () => {
    const pref = createDevicePreference("test.colour", COLOURS, "red");

    expect(pref.read()).toBe("red");
  });

  it("still makes a choice real for the visit", () => {
    // Private mode gets a working toggle; it just forgets on reload.
    const pref = createDevicePreference("test.colour", COLOURS, "red");

    pref.write("blue");

    expect(pref.read()).toBe("blue");
  });
});
