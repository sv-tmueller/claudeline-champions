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
  regex: '(^|/)(bots|client|protocol|server)(/|$)',
  message: 'sim must not reach into the bots, client, protocol or server packages.',
};
const intoClient = {
  regex: '(^|/)(client|protocol|server)(/|$)',
  message: 'bots must not reach into the client, protocol or server packages.',
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

// protocol imports the sim entry and relative paths only. The segment ban keeps a relative path
// from reaching the packages it cannot import by name.
const protocolPatterns = (allowed) => [
  {
    regex: nonRelativeExcept(allowed),
    message: 'protocol imports relative paths and @claudeline/sim only (online design section 3).',
  },
  {
    regex: '(^|/)(bots|client|server)(/|$)',
    message: 'protocol must not reach into the bots, client or server packages.',
  },
  outOfPackage,
  {
    regex: '^\\.{1,2}/(.*/)?sim(/|$)',
    message: 'protocol imports sim through @claudeline/sim only, never by relative path.',
  },
];

// The server imports the three entry points, node: builtins and relative paths (online design
// section 3). `ws` joins the list with package P3, which adds the dependency. The segment ban keeps
// a relative path from reaching the packages it imports by name.
const serverPatterns = (allowed) => [
  {
    regex: `^(?!\\.{1,2}(/|$)|node:|(${allowed.join('|')})$)`,
    message: 'The server imports relative paths, node: builtins and the entry points of @claudeline/sim, @claudeline/bots and @claudeline/protocol only (online design section 3).',
  },
  {
    regex: '^\\.{1,2}/(.*/)?(sim|bots|protocol|client)(/|$)',
    message: 'The server imports its sibling packages by name, never by relative path, and never the client.',
  },
  outOfPackage,
];

// The client never imports the server, by name or by a path with a server segment. The selectors
// below catch import() expressions and import() types, which no-restricted-imports does not see.
// A file such as ./server-socket stays allowed: the segment must be exactly `server`.
const SERVER_IMPORT = '^@claudeline/server(/|$)|^\\.{1,2}/(.*/)?server(/|$)';
const SERVER_IMPORT_IN_SELECTOR = SERVER_IMPORT.replaceAll('/', '\\/');
const SERVER_IMPORT_MESSAGE = 'The client never imports the server (online design section 3).';

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
const PROTOCOL_HOST = 'protocol never touches the clock, timers, the browser or the network (online design section 3).';
const protocolGlobals = [
  'error',
  { name: 'Date', message: PROTOCOL_HOST },
  { name: 'performance', message: PROTOCOL_HOST },
  { name: 'setTimeout', message: PROTOCOL_HOST },
  { name: 'setInterval', message: PROTOCOL_HOST },
  { name: 'window', message: PROTOCOL_HOST },
  { name: 'document', message: PROTOCOL_HOST },
  { name: 'fetch', message: PROTOCOL_HOST },
];
// The sim's math ban, its ** ban and noInlineConfig are not copied: floats cross the wire only
// inside the opaque state, arena and kits, and the codec computes nothing with them.
const protocolProperties = [
  'error',
  { object: 'Math', property: 'random', message: 'protocol has no unseeded randomness (online design section 3).' },
  { object: 'Date', property: 'now', message: PROTOCOL_HOST },
  { object: 'performance', property: 'now', message: PROTOCOL_HOST },
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
    rules: {
      'no-restricted-imports': boundaryRule([{ regex: SERVER_IMPORT, message: SERVER_IMPORT_MESSAGE }]),
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.value=/${SERVER_IMPORT_IN_SELECTOR}/]`,
          message: SERVER_IMPORT_MESSAGE,
        },
        {
          selector: `TSImportType[source.value=/${SERVER_IMPORT_IN_SELECTOR}/]`,
          message: SERVER_IMPORT_MESSAGE,
        },
      ],
    },
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
    // The fixture search shares the format, the replay, the coverage and the oracle with the sim's
    // roster fixture test, so it imports the sim entry and these two files of sim/test and no other
    // file of a package. It reads data/ and writes packages/sim/test/fixtures/ by file path.
    files: ['tools/fixtures/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': boundaryRule([
        {
          regex: '^(?!\\.{1,2}(/|$)|node:|@claudeline/sim$|vitest(/|$))',
          message: 'The fixture tool imports relative paths, node: builtins, vitest and the entry point of @claudeline/sim only.',
        },
        {
          regex: '(^|/)(node_modules|tests|e2e)(/|$)',
          message: 'The fixture tool must not reach into node_modules, tests or e2e.',
        },
        {
          regex: '(^|/)packages/(?!sim/test/(roster-fixture|ability-watch)\\.ts$)',
          message: 'The fixture tool imports packages/sim/test/roster-fixture.ts and ability-watch.ts and no other file of a package.',
        },
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
  {
    files: ['packages/protocol/src/**'],
    rules: {
      'no-restricted-imports': boundaryRule(protocolPatterns(['@claudeline/sim'])),
      'no-restricted-syntax': noDynamicImport,
      'no-restricted-globals': protocolGlobals,
      'no-restricted-properties': protocolProperties,
    },
  },
  {
    files: ['packages/protocol/test/**/*.ts'],
    rules: {
      'no-restricted-imports': boundaryRule(protocolPatterns(['@claudeline/sim', 'vitest'])),
    },
  },
  {
    // The server runs in Node and may read the wall clock, use timers and Math.random: no clock,
    // timer or math bans (online design section 3).
    files: ['packages/server/src/**'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': boundaryRule(
        serverPatterns(['@claudeline/sim', '@claudeline/bots', '@claudeline/protocol']),
      ),
      'no-restricted-syntax': noDynamicImport,
    },
  },
  {
    files: ['packages/server/test/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': boundaryRule(
        serverPatterns(['@claudeline/sim', '@claudeline/bots', '@claudeline/protocol', 'vitest']),
      ),
    },
  },
);
