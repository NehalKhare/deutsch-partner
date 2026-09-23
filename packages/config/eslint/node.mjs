import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";

/**
 * Lint rules for a package that renders nothing: the TypeScript half of the
 * Next preset, which is typescript-eslint's recommended set, plus the one
 * house rule about deliberately unused parameters.
 */
export const unusedVars = {
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
    },
  ],
};

export default defineConfig([
  ...nextTs,
  { rules: unusedVars },
  globalIgnores(["dist/**", "node_modules/**", ".turbo/**"]),
]);
