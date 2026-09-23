/**
 * A working `localStorage` under jsdom.
 *
 * Node 25 defines its own `localStorage` global. Without `--localstorage-file`
 * it is an inert empty object — no `getItem`, no `setItem`, no `clear` — and
 * because it is already on `globalThis` when the jsdom environment installs
 * its own globals, it is what test code actually reaches. Any code that stores
 * something therefore appears to work (the reads and writes are wrapped in
 * try/catch, as they must be for private windows) while persisting nothing,
 * and a test asserting persistence fails for a reason that has nothing to do
 * with the code under test.
 *
 * So: if the ambient storage cannot do the one thing storage is for, replace
 * it with one that can. Guarded, so a runtime that already provides a real
 * implementation keeps it.
 */

class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
}

function usable(candidate: unknown): boolean {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as Storage).getItem === "function" &&
    typeof (candidate as Storage).setItem === "function" &&
    typeof (candidate as Storage).clear === "function"
  );
}

/** Installs a working `localStorage` on `window` and `globalThis` if needed. */
export function installWebStorage(): void {
  if (typeof globalThis === "undefined") return;

  const scope = globalThis as unknown as Record<string, unknown>;
  if (usable(scope.localStorage)) return;

  const storage = new MemoryStorage();
  const descriptor = {
    configurable: true,
    writable: true,
    value: storage,
  } as const;

  Object.defineProperty(scope, "localStorage", descriptor);
  if (typeof window !== "undefined" && window !== (scope as unknown)) {
    Object.defineProperty(window, "localStorage", descriptor);
  }
}
