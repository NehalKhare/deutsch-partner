import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw";
import { installWebStorage } from "./web-storage";

// Under a full-workspace run every package's suite competes for the same
// cores, and a wait that is generous on an idle machine is not generous
// enough. The default is one second; a real hang still fails, later.
configure({ asyncUtilTimeout: 5_000 });

// Node 25 ships an inert `localStorage` global that shadows jsdom's. See
// web-storage.ts: without this, anything that persists a preference silently
// persists nothing.
installWebStorage();

// A unit test must never reach the network. Anything unmocked is a failure.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
  // Storage outlives a render, so one test's choice is the next test's
  // starting state unless it is cleared here. Guarded, because a test is
  // allowed to have swapped in a storage that refuses everything.
  try {
    localStorage?.clear?.();
  } catch {
    // Nothing to clear, which is the state the next test wanted anyway.
  }
});

afterAll(() => server.close());
