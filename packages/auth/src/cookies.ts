type CookieRecord = { name: string; value: string };
type CookieWrite = CookieRecord & { options?: Record<string, unknown> };

export interface RequestCookieStore {
  getAll(): CookieRecord[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

/**
 * Bridges Supabase's cookie contract to a request cookie store.
 *
 * Writes are attempted and ignored on failure: during a Server Component
 * render the store is read-only, and the session refresh will be written by
 * the proxy instead. Letting that throw would break otherwise valid renders.
 */
export function createCookieAdapter(store: RequestCookieStore) {
  return {
    getAll: () => store.getAll(),
    setAll: (cookiesToSet: CookieWrite[]) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      } catch {
        // Read-only store during an RSC render; the proxy refreshes instead.
      }
    },
  };
}

/**
 * A distinct cookie name per app.
 *
 * Two apps of the same project on one host — the learner and operator apps
 * in local development share localhost, and cookies ignore ports — would
 * otherwise overwrite each other's session. Each reads only its own name. The
 * name is hygiene, not the boundary: a token is valid for the project, and
 * what an app does with one is decided by its own checks.
 */
export function cookieOptionsFor(name: string | undefined) {
  return name ? { name } : undefined;
}
