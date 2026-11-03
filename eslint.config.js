import tseslint from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "src-tauri/**", "target/**", "node_modules/**"] },
  ...tseslint.configs["flat/recommended"],
  reactHooks.configs["recommended-latest"],
  {
    rules: {
      // Mocks and stubs mark intentionally unused params with a leading underscore
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
