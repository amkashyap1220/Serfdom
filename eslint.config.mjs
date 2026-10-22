import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/", "**/coverage/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["client/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["server/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
]);
