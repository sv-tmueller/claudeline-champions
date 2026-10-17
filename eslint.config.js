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

// bots reaches sim through @claudeline/sim only. The relative condition keeps
// @claudeline/sim allowed; the segment match keeps files such as ./simplify allowed.
const relativeIntoSim = {
  regex: '^\\.{1,2}/(.*/)?sim(/|$)',
  message: 'bots imports sim through @claudeline/sim only, never by relative path.',
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
// V8's transcendental Math functions are not correctly rounded and differ in the last bit
// between CPU architectures (batch #23 decision 9).
const TRANSCENDENTAL = [
  'atan2',
  'atan',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'exp',
  'log',
  'log2',
  'log10',
  'pow',
  'hypot',
  'cbrt',
  'expm1',
  'log1p',
  'sinh',
  'cosh',
  'tanh',
];
const MATH_PORT =
  'differs in the last bit across CPUs; use the ports in packages/sim/src/dmath.ts (port it there first if missing) or a constant in kit data (spec section 4.8, rule 4).';
const POW =
  '** is V8 pow, which is not correctly rounded; multiply, or port the function to packages/sim/src/dmath.ts (spec section 4.8, rule 4).';
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
  ...TRANSCENDENTAL.map((property) => ({
    object: 'Math',
    property,
    message: `Math.${property} ${MATH_PORT}`,
  })),
];
// bots decisions repeat from the state, the seed and the tick (spec section 4.8): no clock and
// no unseeded randomness. The sim's math ban is not copied; bots tests may use all of these.
const BOTS_CLOCK = 'bots never read the wall clock (spec section 4.8); decisions come from the state.';
const botsGlobals = [
  'error',
  { name: 'Date', message: BOTS_CLOCK },
  { name: 'performance', message: BOTS_CLOCK },
];
const botsProperties = [
  'error',
  {
    object: 'Math',
    property: 'random',
    message: 'bots draw from their own seeded PRNG (packages/bots/src/rng.ts).',
  },
  { object: 'Date', property: 'now', message: BOTS_CLOCK },
  { object: 'performance', property: 'now', message: BOTS_CLOCK },
];
const simSyntax = [
  ...noDynamicImport,
  { selector: "BinaryExpression[operator='**']", message: POW },
  { selector: "AssignmentExpression[operator='**=']", message: POW },
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
    // The balance tool plays the shipped bots through the two entry points. It reads data/ and
    // the node: builtins, never a package's own files, node_modules, tests or e2e.
    files: ['tools/balance/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': boundaryRule([
        {
          regex: '^(?!\\.{1,2}(/|$)|node:|(@claudeline/sim|@claudeline/bots)$|vitest(/|$))',
          message: 'The balance tool imports relative paths, node: builtins, vitest and the entry points of @claudeline/sim and @claudeline/bots only.',
        },
        outOfPackage,
      ]),
      'no-restricted-syntax': noDynamicImport,
    },
  },
  {
    files: ['packages/sim/src/**'],
    // An inline eslint-disable must not silence the determinism bans.
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-imports': boundaryRule(simPatterns),
      'no-restricted-syntax': simSyntax,
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
      'no-restricted-imports': boundaryRule([...botsPatterns(['@claudeline/sim']), relativeIntoSim]),
      'no-restricted-syntax': noDynamicImport,
      'no-restricted-globals': botsGlobals,
      'no-restricted-properties': botsProperties,
    },
  },
  {
    files: ['packages/bots/test/**/*.ts'],
    rules: {
      'no-restricted-imports': boundaryRule([
        ...botsPatterns(['@claudeline/sim', 'vitest']),
        relativeIntoSim,
      ]),
    },
  },
);
