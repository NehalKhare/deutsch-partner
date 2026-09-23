import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { unusedVars } from "./node.mjs";

/** Lint rules for a Next.js app or a package of React components. */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: unusedVars },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".turbo/**"]),
]);
