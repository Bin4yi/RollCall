import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'assets/**', 'archive/**', '**/public/**', 'data/**', 'video/**', 'apps/vitals-worker/runtime/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts, with browser code inside page.evaluate.
    files: ['tools/**/*.mjs'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
