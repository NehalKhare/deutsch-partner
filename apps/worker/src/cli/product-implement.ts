import { z } from "zod";

import { runNow } from "./run-now";

/**
 * Run with: pnpm product:implement <proposal-id>
 *
 * The coding job, in this process, for a machine with a checkout and a
 * token. In production the "coder" queue's worker runs the same handler.
 */
const proposalId = z.uuid().safeParse(process.argv[2]);
if (!proposalId.success) {
  process.stderr.write("\n  Usage: pnpm product:implement <proposal-id>\n\n");
  process.exit(1);
}

runNow({ kind: "productops.implement", proposalId: proposalId.data }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
