import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Matches any specifier that is not a relative path: packages, node: builtins
// and absolute paths.
const NON_RELATIVE = '^(?!\\.{1,2}(/|$))';
// Matches a relative path that goes into the bots or client folders.
const INTO_BOTS_OR_CLIENT = '(^|/)(bots|client)(/|$)';
// Matches a relative path that goes into the client folder.
const INTO_CLIENT = '(^|/)client(/|$)';
// Matches any non-relative specifier except the allowed ones.
function nonRelativeExcept(allowed) {
  const names = allowed.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  return names ? `^(?!\\.{1,2}(/|$)|(${names})(/|$))` : NON_RELATIVE;
}

// Flat config replaces a rule's options when a later block matches the same
// file. It does not merge them. Each block below carries its full list.
// allowTypeImports stays off so `import type` is blocked too.
function boundaryRule(patterns) {
  return ['error', { patterns }];
}

const simPatterns = [
  {
    regex: NON_RELATIVE,
    message: 'sim imports nothing outside itself (spec section 3.2).',
  },
  {
    regex: INTO_BOTS_OR_CLIENT,
    message: 'sim must not reach into the bots or client packages.',
  },
];

const botsPatterns = (allowed) => [
  {
    regex: nonRelativeExcept(allowed),
    message: 'bots imports relative paths and @claudeline/sim only (spec section 3.2).',
  },
  {
    regex: INTO_CLIENT,
    message: 'bots must not reach into the client package.',
  },
];

export default defineConfig(
  {
    ignores: ['**/dist/**', 'test-results/**', 'playwright-report/**', '.claude/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.config.{js,ts}', 'tests/**', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/client/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/sim/src/**/*.ts'],
    rules: { 'no-restricted-imports': boundaryRule(simPatterns) },
  },
  {
    files: ['packages/sim/test/**/*.ts'],
    rules: {
      'no-restricted-imports': boundaryRule([
        {
          regex: nonRelativeExcept(['vitest']),
          message: 'sim tests import relative paths and vitest only.',
        },
        simPatterns[1],
      ]),
    },
  },
  {
    files: ['packages/bots/src/**/*.ts'],
    rules: { 'no-restricted-imports': boundaryRule(botsPatterns(['@claudeline/sim'])) },
  },
  {
    files: ['packages/bots/test/**/*.ts'],
    rules: {
      'no-restricted-imports': boundaryRule(botsPatterns(['@claudeline/sim', 'vitest'])),
    },
  },
);
