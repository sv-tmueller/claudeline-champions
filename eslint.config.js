import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Matches any specifier that is not a relative path: packages, node: builtins
// and absolute paths.
const NON_RELATIVE = '^(?!\\.{1,2}(/|$))';
// Matches any non-relative specifier except the allowed ones.
function nonRelativeExcept(allowed) {
  const names = allowed.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  return `^(?!\\.{1,2}(/|$)|(${names})(/|$))`;
}

// Flat config replaces a rule's options when a later block matches the same
// file. It does not merge them. Each block below carries its full list.
// allowTypeImports stays off so `import type` is blocked too.
function boundaryRule(patterns) {
  return ['error', { patterns }];
}

const intoBotsOrClient = {
  regex: '(^|/)(bots|client)(/|$)',
  message: 'sim must not reach into the bots or client packages.',
};
const intoClient = {
  regex: '(^|/)client(/|$)',
  message: 'bots must not reach into the client package.',
};
// data/ stays allowed: packages.md says sim reads data/arenas, and sim tests
// import it.
const outOfPackage = {
  regex: '(^|/)(node_modules|packages|tests|e2e)(/|$)',
  message: 'Relative imports must stay inside the package.',
};

const simPatterns = [
  { regex: NON_RELATIVE, message: 'sim imports nothing outside itself (spec section 3.2).' },
  intoBotsOrClient,
  outOfPackage,
];

const botsPatterns = (allowed) => [
  {
    regex: nonRelativeExcept(allowed),
    message: 'bots imports relative paths and @claudeline/sim only (spec section 3.2).',
  },
  intoClient,
  outOfPackage,
];

// no-restricted-imports does not see import() expressions or import() types.
const noDynamicImport = [
  'error',
  {
    selector: 'ImportExpression',
    message: 'Use a static import; import() bypasses the boundary rule.',
  },
  {
    selector: 'TSImportType',
    message: "Use import type; import('...') types bypass the boundary rule.",
  },
];

const CLOCK = 'sim never reads the wall clock or uses timers (spec section 4.8).';
const HOST = 'sim never touches the browser or the network (spec section 3.2).';
const simGlobals = [
  'error',
  { name: 'Date', message: CLOCK },
  { name: 'performance', message: CLOCK },
  { name: 'setTimeout', message: CLOCK },
  { name: 'setInterval', message: CLOCK },
  { name: 'window', message: HOST },
  { name: 'document', message: HOST },
  { name: 'fetch', message: HOST },
];
const simProperties = [
  'error',
  {
    object: 'Math',
    property: 'random',
    message: 'sim uses the seeded PRNG in the state (spec section 4.8).',
  },
  { object: 'Date', property: 'now', message: CLOCK },
  { object: 'performance', property: 'now', message: CLOCK },
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
    files: ['packages/sim/src/**'],
    rules: {
      'no-restricted-imports': boundaryRule(simPatterns),
      'no-restricted-syntax': noDynamicImport,
      'no-restricted-globals': simGlobals,
      'no-restricted-properties': simProperties,
    },
  },
  {
    files: ['packages/sim/test/**/*.ts'],
    rules: {
      'no-restricted-imports': boundaryRule([
        {
          regex: nonRelativeExcept(['vitest']),
          message: 'sim tests import relative paths and vitest only.',
        },
        intoBotsOrClient,
        outOfPackage,
      ]),
    },
  },
  {
    files: ['packages/bots/src/**'],
    rules: {
      'no-restricted-imports': boundaryRule(botsPatterns(['@claudeline/sim'])),
      'no-restricted-syntax': noDynamicImport,
    },
  },
  {
    files: ['packages/bots/test/**/*.ts'],
    rules: {
      'no-restricted-imports': boundaryRule(botsPatterns(['@claudeline/sim', 'vitest'])),
    },
  },
);
