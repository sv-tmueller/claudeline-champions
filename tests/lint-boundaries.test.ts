import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

const BOUNDARY_RULES = [
  'no-restricted-imports',
  'no-restricted-syntax',
  'no-restricted-globals',
  'no-restricted-properties',
];

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
const clientFile = 'packages/client/src/virtual.ts';

const IMPORTS = 'no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';
const GLOBALS = 'no-restricted-globals';
const PROPERTIES = 'no-restricted-properties';

type Case = { name: string; file: string; code: string; rule: string | null };

const simGlobalNames = ['Date', 'performance', 'window', 'document', 'fetch', 'setTimeout', 'setInterval'];

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
    code: "import '../../../e2e/smoke.spec';",
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
];

describe('package boundary lint rules', () => {
  it.each(cases)('$name', async ({ file, code, rule }) => {
    const ids = await boundaryRuleIds(file, code);
    if (rule === null) {
      expect(ids).toEqual([]);
    } else {
      expect(ids).toContain(rule);
    }
  });
});
