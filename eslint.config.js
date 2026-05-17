// ESLint flat config for small-world
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Vite injects __APP_VERSION__ at build time
        __APP_VERSION__: "readonly",
      },
    },

    rules: {
      // Browser-focused codebase — allow unused params in callbacks
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },

  {
    ignores: ["dist/**", "node_modules/**", ".vite/**"],
  },
];
