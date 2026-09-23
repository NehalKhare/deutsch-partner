import { flag, runNow } from "./run-now";

/** Run with: pnpm fx:refresh [--force] */
runNow({ kind: "fx.refresh", force: flag("force") }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
