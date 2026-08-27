import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

const securityRules = {
  "security/detect-bidi-characters": "error",
  "security/detect-buffer-noassert": "error",
  "security/detect-child-process": "error",
  "security/detect-disable-mustache-escape": "error",
  "security/detect-eval-with-expression": "error",
  "security/detect-new-buffer": "error",
  "security/detect-no-csrf-before-method-override": "error",
  "security/detect-non-literal-regexp": "error",
  "security/detect-non-literal-require": "error",
  "security/detect-pseudoRandomBytes": "error",
  "security/detect-unsafe-regex": "error",
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { security },
    rules: securityRules,
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { security },
    rules: securityRules,
  },
];
