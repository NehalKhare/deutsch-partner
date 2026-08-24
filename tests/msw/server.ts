import { setupServer } from "msw/node";

/**
 * Shared MSW server. Handlers are registered per test suite via
 * `server.use(...)`; there are no global handlers, so any unmocked outbound
 * request fails the test rather than silently reaching the network.
 */
export const server = setupServer();
