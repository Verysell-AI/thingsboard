// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.react-router/**',
      '**/drizzle/**',
      '**/playwright-report/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // withoutTenant() bypasses row-level security; only provisioning and background jobs may use it.
    files: ['api/src/**/*.ts'],
    ignores: [
      'api/src/cli/**',
      'api/src/cli.ts',
      'api/src/jobs/**',
      'api/src/worker.ts',
      'api/src/db/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../db/tenant.js',
              importNames: ['withoutTenant'],
              message: 'withoutTenant bypasses RLS; only cli/ and jobs/ may use it.',
            },
          ],
          patterns: [
            {
              group: ['**/db/tenant.js', '**/db/tenant'],
              importNames: ['withoutTenant'],
              message: 'withoutTenant bypasses RLS; only cli/ and jobs/ may use it.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
