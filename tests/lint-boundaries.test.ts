import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function restrictedImportMessages(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

const simFile = 'packages/sim/src/virtual.ts';
const botsFile = 'packages/bots/src/virtual.ts';
const clientFile = 'packages/client/src/virtual.ts';

const cases: { name: string; file: string; code: string; blocked: boolean }[] = [
  { name: 'sim imports client', file: simFile, code: "import '@claudeline/client';", blocked: true },
  {
    name: 'sim imports a type from client',
    file: simFile,
    code: "import type { X } from '@claudeline/client'; export type Y = X;",
    blocked: true,
  },
  {
    name: 'sim imports client by relative path',
    file: simFile,
    code: "import '../../client/src/main';",
    blocked: true,
  },
  { name: 'sim imports bots', file: simFile, code: "import '@claudeline/bots';", blocked: true },
  { name: 'sim imports three', file: simFile, code: "import 'three';", blocked: true },
  { name: 'sim imports a node builtin', file: simFile, code: "import 'node:fs';", blocked: true },
  { name: 'sim imports a sibling file', file: simFile, code: "import './other';", blocked: false },
  { name: 'bots imports client', file: botsFile, code: "import '@claudeline/client';", blocked: true },
  { name: 'bots imports three', file: botsFile, code: "import 'three';", blocked: true },
  { name: 'bots imports sim', file: botsFile, code: "import '@claudeline/sim';", blocked: false },
  { name: 'client imports sim', file: clientFile, code: "import '@claudeline/sim';", blocked: false },
  { name: 'client imports bots', file: clientFile, code: "import '@claudeline/bots';", blocked: false },
  { name: 'client imports three', file: clientFile, code: "import 'three';", blocked: false },
];

describe('package boundary lint rules', () => {
  it.each(cases)('$name', async ({ file, code, blocked }) => {
    const messages = await restrictedImportMessages(file, code);
    if (blocked) {
      expect(messages).not.toEqual([]);
    } else {
      expect(messages).toEqual([]);
    }
  });
});
