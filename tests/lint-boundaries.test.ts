import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

const IMPORTS = 'no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';
const GLOBALS = 'no-restricted-globals';
const PROPERTIES = 'no-restricted-properties';

const BOUNDARY_RULES = [IMPORTS, SYNTAX, GLOBALS, PROPERTIES];

async function boundaryRuleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  // A parse error would otherwise look like an allowed row.
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages.flatMap((m) => (m.ruleId && BOUNDARY_RULES.includes(m.ruleId) ? [m.ruleId] : []));
}

const simFile = 'packages/sim/src/virtual.ts';
const simMtsFile = 'packages/sim/src/virtual.mts';
const simTestFile = 'packages/sim/test/virtual.test.ts';
const botsFile = 'packages/bots/src/virtual.ts';
const botsCtsFile = 'packages/bots/src/virtual.cts';
const botsTestFile = 'packages/bots/test/virtual.test.ts';
const clientFile = 'packages/client/src/virtual.ts';
const balanceFile = 'tools/balance/virtual.ts';

type Case = { name: string; file: string; code: string; rule: string | null };

const simGlobalNames = ['Date', 'performance', 'window', 'document', 'fetch', 'setTimeout', 'setInterval'];

// Written out here, never imported from the config, so a name dropped from the config fails a row.
const bannedMathNames = [
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
const exactMath = [
  'Math.sqrt(2)',
  'Math.abs(-1)',
  'Math.round(1.5)',
  'Math.min(1, 2)',
  'Math.max(1, 2)',
  'Math.imul(3, 4)',
  'Math.PI',
];

const cases: Case[] = [
  { name: 'sim imports client', file: simFile, code: "import '@claudeline/client';", rule: IMPORTS },
  {
    name: 'sim imports a type from client',
    file: simFile,
    code: "import type { X } from '@claudeline/client'; export type Y = X;",
    rule: IMPORTS,
  },
  {
    name: 'sim imports client by relative path',
    file: simFile,
    code: "import '../../client/src/main';",
    rule: IMPORTS,
  },
  { name: 'sim imports bots', file: simFile, code: "import '@claudeline/bots';", rule: IMPORTS },
  { name: 'sim imports three', file: simFile, code: "import 'three';", rule: IMPORTS },
  { name: 'sim imports a node builtin', file: simFile, code: "import 'node:fs';", rule: IMPORTS },
  { name: 'sim imports a sibling file', file: simFile, code: "import './other';", rule: null },
  { name: 'sim imports from tests by relative path', file: simFile, code: "import '../../../tests/x';", rule: IMPORTS },
  {
    name: 'sim imports node_modules by relative path',
    file: simFile,
    code: "import '../../../node_modules/three';",
    rule: IMPORTS,
  },
  {
    name: 'sim imports from e2e by relative path',
    file: simFile,
    code: "import '../../../e2e/scene.spec';",
    rule: IMPORTS,
  },
  {
    name: 'sim imports bots by relative path through packages',
    file: simFile,
    code: "import '../../../packages/bots/src/index';",
    rule: IMPORTS,
  },
  { name: 'bots imports client', file: botsFile, code: "import '@claudeline/client';", rule: IMPORTS },
  { name: 'bots imports three', file: botsFile, code: "import 'three';", rule: IMPORTS },
  { name: 'bots imports sim', file: botsFile, code: "import '@claudeline/sim';", rule: null },
  { name: 'bots imports from tests by relative path', file: botsFile, code: "import '../../../tests/x';", rule: IMPORTS },
  {
    name: 'bots imports sim through packages by relative path',
    file: botsFile,
    code: "import '../../../packages/sim/src/index';",
    rule: IMPORTS,
  },
  {
    name: 'bots imports a future package through packages by relative path',
    file: botsFile,
    code: "import '../../../packages/protocol/src/index';",
    rule: IMPORTS,
  },
  {
    name: 'bots imports sim internals by relative path',
    file: botsFile,
    code: "import '../../sim/src/collision';",
    rule: IMPORTS,
  },
  {
    name: 'bots imports a sibling file with sim in its name',
    file: botsFile,
    code: "import './simplify';",
    rule: null,
  },
  {
    name: 'bots test imports sim test helpers by relative path',
    file: botsTestFile,
    code: "import '../../sim/test/helpers';",
    rule: IMPORTS,
  },
  {
    name: 'bots test imports sim source by relative path',
    file: botsTestFile,
    code: "import '../../sim/src/step';",
    rule: IMPORTS,
  },
  {
    name: 'bots test imports a kit data file',
    file: botsTestFile,
    code: "import kit from '../../../data/kits/hargrim.json'; export { kit };",
    rule: null,
  },
  {
    name: 'bots test imports bots source by relative path',
    file: botsTestFile,
    code: "import '../src/sight';",
    rule: null,
  },
  { name: 'bots calls Date.now', file: botsFile, code: 'export const t = Date.now();', rule: PROPERTIES },
  { name: 'bots calls Math.random', file: botsFile, code: 'export const r = Math.random();', rule: PROPERTIES },
  {
    name: 'bots calls performance.now',
    file: botsFile,
    code: 'export const t = performance.now();',
    rule: PROPERTIES,
  },
  { name: 'bots reads the global Date', file: botsFile, code: 'export const x = Date;', rule: GLOBALS },
  {
    name: 'bots reads the global performance',
    file: botsFile,
    code: 'export const x = performance;',
    rule: GLOBALS,
  },
  {
    name: 'bots uses Math.hypot and Math.sqrt',
    file: botsFile,
    code: 'export const v = Math.hypot(3, 4) + Math.sqrt(2);',
    rule: null,
  },
  {
    name: 'bots test calls Date.now and Math.random',
    file: botsTestFile,
    code: 'export const v = Date.now() + Math.random();',
    rule: null,
  },
  {
    name: 'sim test imports from tests by relative path',
    file: simTestFile,
    code: "import '../../../tests/x';",
    rule: IMPORTS,
  },
  {
    name: 'sim test imports the arena data file',
    file: simTestFile,
    code: "import arena from '../../../data/arenas/arena01.json'; export { arena };",
    rule: null,
  },
  { name: 'sim .mts file imports three', file: simMtsFile, code: "import 'three';", rule: IMPORTS },
  { name: 'bots .cts file imports three', file: botsCtsFile, code: "import 'three';", rule: IMPORTS },
  { name: 'client imports sim', file: clientFile, code: "import '@claudeline/sim';", rule: null },
  { name: 'client imports bots', file: clientFile, code: "import '@claudeline/bots';", rule: null },
  { name: 'client imports three', file: clientFile, code: "import 'three';", rule: null },
  {
    name: 'client uses the clock, Math.random and a dynamic import',
    file: clientFile,
    code: "export const t = Date.now() + Math.random(); export const p = import('three');",
    rule: null,
  },
  {
    name: 'sim uses a dynamic import of a package',
    file: simFile,
    code: "export const p = import('three');",
    rule: SYNTAX,
  },
  {
    name: 'sim uses a dynamic import of a sibling file',
    file: simFile,
    code: "export const p = import('./other');",
    rule: SYNTAX,
  },
  {
    name: 'sim uses an import type',
    file: simFile,
    code: "export type T = import('three').Vector3;",
    rule: SYNTAX,
  },
  {
    name: 'bots uses a dynamic import of client',
    file: botsFile,
    code: "export const p = import('@claudeline/client');",
    rule: SYNTAX,
  },
  { name: 'sim calls Date.now', file: simFile, code: 'export const t = Date.now();', rule: PROPERTIES },
  { name: 'sim calls Math.random', file: simFile, code: 'export const r = Math.random();', rule: PROPERTIES },
  {
    name: 'sim calls performance.now',
    file: simFile,
    code: 'export const t = performance.now();',
    rule: PROPERTIES,
  },
  { name: 'sim calls Math.floor', file: simFile, code: 'export const f = Math.floor(1.5);', rule: null },
  ...simGlobalNames.map((name) => ({
    name: `sim reads the global ${name}`,
    file: simFile,
    code: `export const x = ${name};`,
    rule: GLOBALS,
  })),
  ...bannedMathNames.map((name) => ({
    name: `sim calls Math.${name}`,
    file: simFile,
    code: `export const v = Math.${name}(0.5, 0.5);`,
    rule: PROPERTIES,
  })),
  ...exactMath.map((expression) => ({
    name: `sim uses ${expression}`,
    file: simFile,
    code: `export const v = ${expression};`,
    rule: null,
  })),
  { name: 'sim uses the ** operator', file: simFile, code: 'export const v = 2 ** 3;', rule: SYNTAX },
  {
    name: 'sim uses the **= operator',
    file: simFile,
    code: 'let v = 2; v **= 3; export { v };',
    rule: SYNTAX,
  },
  {
    // Pins linterOptions.noInlineConfig: an inline disable must not silence the ban.
    name: 'sim silences the Math.sin ban with an inline disable',
    file: simFile,
    code: '// eslint-disable-next-line no-restricted-properties\nexport const v = Math.sin(1);',
    rule: PROPERTIES,
  },
  {
    name: 'sim test uses the banned math and **',
    file: simTestFile,
    code: 'export const v = Math.atan2(1, 2) + Math.hypot(3, 4) + Math.sin(1) + 2 ** 3;',
    rule: null,
  },
  {
    // The balance tool reads the packages through their entry points only.
    name: 'balance tool imports a bots test by relative path',
    file: balanceFile,
    code: "import '../../packages/bots/test/helpers';",
    rule: IMPORTS,
  },
  {
    // Pins the allow-list and the `$` anchor: a deep path into a package is not its entry point.
    name: 'balance tool imports a file inside @claudeline/sim',
    file: balanceFile,
    code: "import '@claudeline/sim/src/kit';",
    rule: IMPORTS,
  },
  {
    name: 'balance tool uses a dynamic import',
    file: balanceFile,
    code: "export const p = import('node:fs');",
    rule: SYNTAX,
  },
  {
    name: 'client uses Math.sin and Math.cos',
    file: clientFile,
    code: 'export const v = Math.sin(1) + Math.cos(1);',
    rule: null,
  },
];

// The first row has hit Vitest's 5 s default timeout while the machine ran several e2e suites at
// once (batch #23 decision 8). It never reproduced on CI or on an idle machine.
describe('package boundary lint rules', { timeout: 30_000 }, () => {
  it.each(cases)('$name', async ({ file, code, rule }) => {
    const ids = await boundaryRuleIds(file, code);
    if (rule === null) {
      expect(ids).toEqual([]);
    } else {
      expect(ids).toContain(rule);
    }
  });
});
