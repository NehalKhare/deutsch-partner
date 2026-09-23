import { createServer, type Server } from "node:http";

/**
 * Two answers on one port: alive, and recently polling.
 *
 * A worker that cannot reach the queue is alive and not ready; the platform
 * should route no traffic to it (there is none) and should not restart it for
 * a database blip either. A worker whose loop has stopped polling is neither.
 */
export interface HealthStatus {
  readonly queues: readonly string[];
  readonly inflight: number;
  readonly lastPollAt: number | null;
  readonly lastPollOk: boolean;
}

export const STALE_POLL_MS = 60_000;

export function startHealthServer(port: number, status: () => HealthStatus): Server {
  const server = createServer((request, response) => {
    const current = status();
    const polledRecently =
      current.lastPollAt !== null && Date.now() - current.lastPollAt < STALE_POLL_MS;

    if (request.url === "/healthz") {
      response.writeHead(polledRecently ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify(current));
      return;
    }
    if (request.url === "/readyz") {
      response.writeHead(polledRecently && current.lastPollOk ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(current));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(port, "0.0.0.0");
  return server;
}
