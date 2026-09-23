import { runNow } from "./run-now";

/**
 * Run with: pnpm cost:rollup [--since <days>]
 *
 * Without `--since` it does what the hourly job does: rebuild the tail, or
 * backfill the whole ledger if the rollup is empty. That is the one to reach
 * for after deploying the job for the first time — the spend calendar fills
 * with whatever history the ledger already holds, without waiting for the
 * scheduler's first tick.
 */
const since = process.argv.indexOf("--since");
const sinceDays = since === -1 ? null : Number(process.argv[since + 1]);

if (sinceDays !== null && (!Number.isInteger(sinceDays) || sinceDays < 1)) {
  process.stderr.write("--since takes a whole number of days, at least 1\n");
  process.exit(1);
}

runNow({ kind: "cost.rollup", sinceDays }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
