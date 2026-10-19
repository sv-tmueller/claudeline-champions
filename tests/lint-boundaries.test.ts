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
const protocolFile = 'packages/protocol/src/virtual.ts';
const protocolTestFile = 'packages/protocol/test/virtual.test.ts';
const clientFile = 'packages/client/src/virtual.ts';
const balanceFile = 'tools/balance/virtual.ts';
const fixturesFile = 'tools/fixtures/virtual.ts';

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

const protocolBannedImports: [string, string][] = [
  ['@claudeline/bots', "import '@claudeline/bots';"],
  ['a type from @claudeline/bots', "import type { Difficulty } from '@claudeline/bots'; export type D = Difficulty;"],
  ['@claudeline/client', "import '@claudeline/client';"],
  ['@claudeline/server', "import '@claudeline/server';"],
  ['ws', "import 'ws';"],
  ['a node: builtin', "import 'node:fs';"],
  ['a node builtin without the prefix', "import 'fs';"],
  ['bots by relative path', "import '../../bots/src/index';"],
  ['client by relative path', "import '../../client/src/main';"],
  ['server by relative path', "import '../../server/src/room';"],
  ['sim source by relative path', "import '../../sim/src/input';"],
  ['tests by relative path', "import '../../../tests/x';"],
  ['node_modules by relative path', "import '../../../node_modules/three';"],
  ['another package through packages by relative path', "import '../../../packages/sim/src/index';"],
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
    name: 'bots imports protocol through packages by relative path',
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
    // The fixture search shares the format, the replay, the coverage and the oracle with the sim's
    // roster fixture test, so it may import those two files of sim/test and the sim entry.
    name: 'fixture tool imports the shared roster-fixture module of sim tests',
    file: fixturesFile,
    code: "import '../../packages/sim/test/roster-fixture.ts';",
    rule: null,
  },
  {
    name: 'fixture tool imports the ability oracle of sim tests',
    file: fixturesFile,
    code: "import '../../packages/sim/test/ability-watch.ts';",
    rule: null,
  },
  {
    name: 'fixture tool imports the sim entry point',
    file: fixturesFile,
    code: "import '@claudeline/sim';",
    rule: null,
  },
  {
    name: 'fixture tool imports a file of sim source by relative path',
    file: fixturesFile,
    code: "import '../../packages/sim/src/kit.ts';",
    rule: IMPORTS,
  },
  {
    name: 'fixture tool imports another sim test module',
    file: fixturesFile,
    code: "import '../../packages/sim/test/helpers.ts';",
    rule: IMPORTS,
  },
  {
    // Pins the `$` anchor: the allowed file name is not a prefix match.
    name: 'fixture tool imports the roster fixture test itself',
    file: fixturesFile,
    code: "import '../../packages/sim/test/roster-fixtures.test.ts';",
    rule: IMPORTS,
  },
  {
    name: 'fixture tool imports a bots test by relative path',
    file: fixturesFile,
    code: "import '../../packages/bots/test/helpers.ts';",
    rule: IMPORTS,
  },
  {
    name: 'fixture tool imports @claudeline/bots',
    file: fixturesFile,
    code: "import '@claudeline/bots';",
    rule: IMPORTS,
  },
  {
    name: 'fixture tool imports a file inside @claudeline/sim',
    file: fixturesFile,
    code: "import '@claudeline/sim/src/kit';",
    rule: IMPORTS,
  },
  {
    name: 'fixture tool uses a dynamic import',
    file: fixturesFile,
    code: "export const p = import('node:fs');",
    rule: SYNTAX,
  },
  {
    name: 'client uses Math.sin and Math.cos',
    file: clientFile,
    code: 'export const v = Math.sin(1) + Math.cos(1);',
    rule: null,
  },
  // The protocol source imports relative paths and the sim entry only (online design section 3).
  ...protocolBannedImports.map(([what, code]) => ({
    name: `protocol imports ${what}`,
    file: protocolFile,
    code,
    rule: IMPORTS,
  })),
  {
    name: 'protocol uses a dynamic import of a sibling file',
    file: protocolFile,
    code: "export const p = import('./other');",
    rule: SYNTAX,
  },
  {
    name: 'protocol uses an import type of the sim',
    file: protocolFile,
    code: "export type T = import('@claudeline/sim').PlayerInput;",
    rule: SYNTAX,
  },
  ...simGlobalNames.map((name) => ({
    name: `protocol reads the global ${name}`,
    file: protocolFile,
    code: `export const x = ${name};`,
    rule: GLOBALS,
  })),
  { name: 'protocol calls Math.random', file: protocolFile, code: 'export const r = Math.random();', rule: PROPERTIES },
  { name: 'protocol calls Date.now', file: protocolFile, code: 'export const t = Date.now();', rule: PROPERTIES },
  {
    name: 'protocol calls performance.now',
    file: protocolFile,
    code: 'export const t = performance.now();',
    rule: PROPERTIES,
  },
  { name: 'protocol imports sim', file: protocolFile, code: "import '@claudeline/sim';", rule: null },
  {
    name: 'protocol imports a type from sim',
    file: protocolFile,
    code: "import type { PlayerInput } from '@claudeline/sim'; export type P = PlayerInput;",
    rule: null,
  },
  { name: 'protocol imports a sibling file', file: protocolFile, code: "import './codec';", rule: null },
  {
    name: 'protocol imports a sibling file with sim in its name',
    file: protocolFile,
    code: "import './simple';",
    rule: null,
  },
  {
    // The determinism ban on math is not the codec's: floats cross the wire only inside the opaque
    // state, arena and kits, and the codec computes nothing with them.
    name: 'protocol uses Math.sin and the ** operator',
    file: protocolFile,
    code: 'export const v = Math.sin(1) + 2 ** 3;',
    rule: null,
  },
  { name: 'protocol test imports vitest', file: protocolTestFile, code: "import 'vitest';", rule: null },
  { name: 'protocol test imports sim', file: protocolTestFile, code: "import '@claudeline/sim';", rule: null },
  { name: 'protocol test imports protocol source', file: protocolTestFile, code: "import '../src/codec';", rule: null },
  {
    name: 'protocol test imports the arena data file',
    file: protocolTestFile,
    code: "import arena from '../../../data/arenas/arena02.json'; export { arena };",
    rule: null,
  },
  {
    name: 'protocol test imports bots',
    file: protocolTestFile,
    code: "import '@claudeline/bots';",
    rule: IMPORTS,
  },
  {
    name: 'protocol test imports sim test helpers by relative path',
    file: protocolTestFile,
    code: "import '../../sim/test/helpers';",
    rule: IMPORTS,
  },
  {
    name: 'protocol test imports a node builtin',
    file: protocolTestFile,
    code: "import 'node:fs';",
    rule: IMPORTS,
  },
  {
    name: 'protocol test imports server by relative path',
    file: protocolTestFile,
    code: "import '../../server/src/room';",
    rule: IMPORTS,
  },
  // The client never imports the server, statically or dynamically (online design section 3).
  { name: 'client imports @claudeline/server', file: clientFile, code: "import '@claudeline/server';", rule: IMPORTS },
  {
    name: 'client imports a file inside @claudeline/server',
    file: clientFile,
    code: "import '@claudeline/server/src/room';",
    rule: IMPORTS,
  },
  {
    name: 'client imports server by relative path',
    file: clientFile,
    code: "import '../../server/src/room';",
    rule: IMPORTS,
  },
  {
    name: 'client uses a dynamic import of @claudeline/server',
    file: clientFile,
    code: "export const p = import('@claudeline/server');",
    rule: SYNTAX,
  },
  {
    name: 'client uses a dynamic import of server by relative path',
    file: clientFile,
    code: "export const p = import('../../server/src/room');",
    rule: SYNTAX,
  },
  {
    name: 'client uses an import type of @claudeline/server',
    file: clientFile,
    code: "export type T = import('@claudeline/server').Room;",
    rule: SYNTAX,
  },
  { name: 'client imports protocol', file: clientFile, code: "import '@claudeline/protocol';", rule: null },
  {
    name: 'client keeps its dev-only dynamic import of the debug shot',
    file: clientFile,
    code: "export const p = import('./debug-shot');",
    rule: null,
  },
  {
    name: 'client uses a dynamic import of a file whose name starts with server',
    file: clientFile,
    code: "export const p = import('./server-socket');",
    rule: null,
  },
  { name: 'client imports a file whose name starts with server', file: clientFile, code: "import './serverless';", rule: null },
  // The segment bans of sim and bots name protocol too: the unchanged rules, enforced for it.
  { name: 'sim imports protocol', file: simFile, code: "import '@claudeline/protocol';", rule: IMPORTS },
  {
    name: 'sim imports protocol by relative path',
    file: simFile,
    code: "import '../../protocol/src/index';",
    rule: IMPORTS,
  },
  {
    name: 'sim test imports protocol by relative path',
    file: simTestFile,
    code: "import '../../protocol/src/index';",
    rule: IMPORTS,
  },
  { name: 'bots imports protocol', file: botsFile, code: "import '@claudeline/protocol';", rule: IMPORTS },
  {
    name: 'bots imports protocol by relative path',
    file: botsFile,
    code: "import '../../protocol/src/index';",
    rule: IMPORTS,
  },
  { name: 'bots test imports protocol', file: botsTestFile, code: "import '@claudeline/protocol';", rule: IMPORTS },
  {
    name: 'bots test imports protocol by relative path',
    file: botsTestFile,
    code: "import '../../protocol/src/index';",
    rule: IMPORTS,
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
