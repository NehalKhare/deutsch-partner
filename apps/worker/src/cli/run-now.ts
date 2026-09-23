import { randomUUID } from "node:crypto";

import type { JobPayload } from "@dp/domain/jobs";

import { withFields } from "@dp/observability/logger";

import { createWorkerContext } from "../composition";
import { workerEnv } from "../env";
import { handleJob } from "../handlers";

/**
 * Runs one job in this process, for the command lines.
 *
 * The same handler a worker would run, with the same wiring, so what a
 * command does on a laptop is what the queue does in production. Exits
 * non-zero on anything but done, so a scripted invocation is visibly broken
 * rather than quietly partial.
 */
export async function runNow(payload: Omit<JobPayload, "correlationId" | "source"> & Partial<JobPayload>): Promise<void> {
  const context = createWorkerContext(workerEnv());
  const full = { correlationId: randomUUID(), source: "cli", ...payload } as JobPayload;
  const logger = withFields(context.logger, { kind: full.kind, correlationId: full.correlationId });

  const outcome = await handleJob(full, context, { jobId: 0, attempt: 1, logger });

  process.stdout.write(`\n  ${full.kind}: ${outcome.status}`);
  if (outcome.status === "done" && outcome.detail) {
    process.stdout.write(` ${JSON.stringify(outcome.detail)}`);
  }
  if (outcome.status !== "done") {
    process.stdout.write(` (${outcome.errorCode})`);
    process.exitCode = 1;
  }
  process.stdout.write("\n\n");
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}
