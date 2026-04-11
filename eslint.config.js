import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/cloud/aws/**', '**/cloud/gcp/**'],
            message: 'Import from src/cloud/core.ts only — provider internals are private.',
          },
        ],
      }],
    },
  },
  {
    files: [
      'src/cloud/aws/**/*.ts',
      'src/cloud/gcp/**/*.ts',
      'src/cloud/factory.ts',
      // The library entry point deliberately re-exports the provider
      // classes as part of the public API surface (see comment in
      // src/index.ts). E2E tests are covered by the tests/e2e rule
      // below.
      'src/index.ts',
      'tests/**/cloud/**/*.ts',
      'tests/e2e/**/*.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
];
