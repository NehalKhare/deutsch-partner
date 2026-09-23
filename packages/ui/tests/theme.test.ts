import { afterEach, describe, expect, it } from "vitest";

import {
  applyPreference,
  isThemePreference,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
} from "../src/theme";
import {
  setThemePreference,
  subscribeToTheme,
  themeStore,
} from "../src/theme-store";

/**
 * The rules the toggle and the inline head script both depend on.
 *
 * The one that matters most is that "system" puts *no* attribute on the
 * document. The CSS resolves the OS preference through a media query, so an
 * attribute saying "system" would be a second, competing answer to a question
 * already answered — and the page would stop following the OS the moment
 * somebody chose the default explicitly.
 */

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

describe("reading the stored preference", () => {
  it("is system when nothing has been stored", () => {
    expect(themeStore.read()).toBe("system");
  });

  it("returns an override that was stored", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    expect(themeStore.read()).toBe("light");
  });

  it("falls back to system rather than trusting a value it did not write", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "solarized");

    expect(themeStore.read()).toBe("system");
  });
});

describe("choosing a theme", () => {
  it("stores the choice and puts it on the document at once", () => {
    setThemePreference("dark");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("takes the attribute off again for system, handing it back to the OS", () => {
    setThemePreference("light");
    setThemePreference("system");

    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });
});

describe("putting a preference on a document", () => {
  it("writes the attribute for an override", () => {
    const root = fakeRoot();
    applyPreference(root, "light");

    expect(root.attributes.get(THEME_ATTRIBUTE)).toBe("light");
  });

  it("removes it for system", () => {
    const root = fakeRoot();
    applyPreference(root, "dark");
    applyPreference(root, "system");

    expect(root.attributes.has(THEME_ATTRIBUTE)).toBe(false);
  });
});

describe("watching for changes", () => {
  it("tells a subscriber about a choice made here", () => {
    let heard = 0;
    const stop = subscribeToTheme(() => (heard += 1));

    setThemePreference("dark");
    stop();

    expect(heard).toBe(1);
  });

  it("applies a change made in another tab to this document too", () => {
    const stop = subscribeToTheme(() => {});

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    stop();

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });

  it("stops listening once the subscription is dropped", () => {
    let heard = 0;
    subscribeToTheme(() => (heard += 1))();

    setThemePreference("dark");

    expect(heard).toBe(0);
  });
});

describe("resolving what is actually on screen", () => {
  it("follows the OS under system", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("ignores the OS under an override", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });
});

describe("what counts as a preference", () => {
  it("accepts the three and nothing else", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});
