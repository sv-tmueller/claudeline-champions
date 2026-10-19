import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFixture, mirrorConfig } from '../../packages/sim/test/roster-fixture.ts';
import type { Fixture } from '../../packages/sim/test/roster-fixture.ts';
import { formatFixture } from './format.ts';

const KITS = ['hargrim', 'quillon', 'skerrow', 'lumeth'];

function committedText(kit: string): string {
  const url = new URL(`../../packages/sim/test/fixtures/scripted-roster-${kit}-arena01-2v2.json`, import.meta.url);
  return readFileSync(url, 'utf8');
}

describe('formatFixture', () => {
  it.each(KITS)('writes the committed %s fixture byte for byte', (kit) => {
    const text = committedText(kit);
    expect(formatFixture(decodeFixture(JSON.parse(text), kit))).toBe(text);
  });

  /** The smallest fixture the decoder takes: 1200 ticks in one segment, no actions. */
  function bare(): Fixture {
    const kit = 'hargrim';
    return {
      format: 1,
      arena: 'arena01',
      seed: 5555,
      config: mirrorConfig(kit),
      ticks: 1200,
      segments: [{ ticks: 1200, inputs: [null, [0, 0, 0, 0, 0], [1, -1, -1200, 200, 64], [0, 0, 0, 0, 0]] }],
      actions: [],
      checkpoints: Array.from({ length: 12 }, (_, i) => ({ tick: (i + 1) * 100, checksum: i })),
      checksum: 11,
    };
  }

  it('writes an empty actions list as "actions": [] on one line', () => {
    const text = formatFixture(bare());
    expect(text).toContain('  ],\n  "actions": [],\n  "checkpoints": [\n');
  });

  it('writes a missing input as null and keeps each segment on one line', () => {
    const text = formatFixture(bare());
    expect(text).toContain(
      '    { "ticks": 1200, "inputs": [null,[0,0,0,0,0],[1,-1,-1200,200,64],[0,0,0,0,0]] }\n',
    );
  });

  it('ends with one newline and parses back to the same fixture', () => {
    const fixture = bare();
    const text = formatFixture(fixture);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(JSON.parse(text)).toEqual(fixture);
  });

  it('keeps the key order of the committed files', () => {
    const keys = Object.keys(JSON.parse(formatFixture(bare())));
    expect(keys).toEqual(['format', 'arena', 'seed', 'config', 'ticks', 'segments', 'actions', 'checkpoints', 'checksum']);
  });
});
