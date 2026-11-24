import { describe, expect, test } from 'vitest';
import { botsNames, formatReport, parseTrace } from './parse.ts';

// Trace lines in, rows out. Nothing here starts a browser. The V8 lines below are the formats
// of bots.md ("The drops of #303, measured (#318)", step 3 of the method).

const NAMES = {
  bots: new Set(['segmentHitsBox', 'needsPlan', 'dodgeInto', 'hasStatus', 'think', 'orbUpInto']),
  ambiguous: new Set(['hasStatus', 'think']),
};

function bailout(name: string, offset: number, reason = 'wrong map', kind = 'deopt-eager', sfi = '0x1a2b'): string {
  return `[bailout (kind: ${kind}, reason: ${reason}): begin. deoptimizing 0x3c4d <JSFunction ${name} (sfi = ${sfi})>, 0x5e6f <Code MAGLEV>, opt id 7, bytecode offset ${offset}, deopt exit 3, FP to SP delta 40, caller SP 0x7a8b, pc 0x9c0d]`;
}
function marking(name: string, reason: string): string {
  return `[marking dependent code 0x1e2f (opt id 4) (0x3a4b <SharedFunctionInfo ${name}>) for deoptimization, reason: ${reason}]`;
}
function compiled(name: string, target = 'MAGLEV', osr = false, sfi = '0x1a2b'): string {
  return `[completed compiling 0x3c4d <JSFunction ${name} (sfi = ${sfi})> (target ${target})${osr ? ' OSR' : ''} - took 0.1, 0.4, 0.2 ms]`;
}
function window(tick: number, phase = 'round', round = '1'): string {
  return `#window ${JSON.stringify({ tick, phase, round })}`;
}

describe('parseTrace', () => {
  test('a function that never recompiles stays open to the match end', () => {
    const report = parseTrace(
      [bailout('needsPlan', 94, 'out of bounds'), window(1289), window(1319), window(4289, 'matchEnd', '3')],
      NAMES,
    );
    expect(report.stints).toHaveLength(1);
    expect(report.stints[0]).toMatchObject({
      name: 'needsPlan',
      how: 'deopt',
      kind: 'deopt-eager',
      offset: 94,
      reason: 'out of bounds',
      dropTick: 1289,
      backTick: null,
      ticks: null,
    });
    expect(report.matchEnd).toBe(4289);
  });

  test('a compile after the drop line in the same window closes the stint with no ticks lost', () => {
    const report = parseTrace(
      [bailout('segmentHitsBox', 228), compiled('segmentHitsBox', 'TURBOFAN_JS'), window(239)],
      NAMES,
    );
    expect(report.stints[0]).toMatchObject({ dropTick: 239, backTick: 239, ticks: 0, backTarget: 'TURBOFAN_JS' });
  });

  test('a compile before the drop line in the same window is not its recompile', () => {
    const report = parseTrace([compiled('segmentHitsBox'), bailout('segmentHitsBox', 228), window(239)], NAMES);
    expect(report.stints[0]).toMatchObject({ dropTick: 239, backTick: null, ticks: null });
  });

  test('an OSR compile is not a recompile', () => {
    const report = parseTrace(
      [bailout('dodgeInto', 806), window(2519), compiled('dodgeInto', 'TURBOFAN_JS', true), window(2549)],
      NAMES,
    );
    expect(report.stints[0]).toMatchObject({ backTick: null });
  });

  test('a mark followed by a lazy bailout is one stint, dated at the mark with its reason', () => {
    const report = parseTrace(
      [
        marking('dodgeInto', 'dependent prototype chain changed'),
        window(9749),
        bailout('dodgeInto', 12, 'dependent code', 'deopt-lazy'),
        window(9779),
        compiled('dodgeInto'),
        window(9809),
      ],
      NAMES,
    );
    expect(report.stints).toHaveLength(1);
    expect(report.stints[0]).toMatchObject({
      how: 'marked',
      reason: 'dependent prototype chain changed',
      dropTick: 9749,
      backTick: 9809,
      ticks: 60,
      backTarget: 'MAGLEV',
    });
  });

  test('a line takes the tick of the next marker, and lines after the last marker are kept apart', () => {
    const late = bailout('needsPlan', 94);
    const report = parseTrace(
      [bailout('dodgeInto', 806), window(29), bailout('hasStatus', 7), window(59), late],
      NAMES,
    );
    expect(report.stints.map((s) => [s.name, s.dropTick])).toEqual([
      ['dodgeInto', 29],
      ['hasStatus', 59],
    ]);
    expect(report.afterLastWindow).toEqual([late]);
  });

  test('names outside the bots set are ignored, and two sfi addresses with one name are one function', () => {
    const report = parseTrace(
      [
        bailout('stepSim', 5),
        marking('Vector3', 'x'),
        bailout('needsPlan', 94, 'out of bounds', 'deopt-eager', '0xaaaa'),
        bailout('needsPlan', 94, 'out of bounds', 'deopt-eager', '0xbbbb'),
        window(29),
        compiled('needsPlan', 'MAGLEV', false, '0xbbbb'),
        window(59),
      ],
      NAMES,
    );
    expect(report.stints).toHaveLength(1);
    expect(report.stints[0]).toMatchObject({ name: 'needsPlan', dropTick: 29, backTick: 59, ticks: 30 });
  });

  test('a name found outside the bots source is flagged ambiguous', () => {
    const report = parseTrace([bailout('hasStatus', 7), bailout('think', 3), bailout('dodgeInto', 806), window(29)], NAMES);
    expect(report.stints.map((s) => [s.name, s.ambiguous])).toEqual([
      ['hasStatus', true],
      ['think', true],
      ['dodgeInto', false],
    ]);
  });

  test('the warm-up end is the first round that begins after the warm-up ticks, and the match end the first matchEnd', () => {
    const report = parseTrace(
      [
        window(2069, 'round', '2'),
        window(2099, 'round', '2'),
        window(2129, 'round', '2'),
        window(2999, 'roundEnd', '2'),
        window(3029, 'round', '3'),
        window(3059, 'round', '3'),
        window(4289, 'matchEnd', '3'),
        window(4319, 'matchEnd', '3'),
      ],
      NAMES,
    );
    expect(report.warmUpEnd).toBe(3029);
    expect(report.matchEnd).toBe(4289);
    expect(report.roundStarts).toEqual([
      { round: '2', tick: 2069 },
      { round: '3', tick: 3029 },
    ]);
  });

  test('drops after the warm-up end are flagged, and the ends are null when no read gives them', () => {
    const report = parseTrace(
      [
        window(2069, 'round', '2'),
        bailout('dodgeInto', 806),
        window(2999, 'round', '2'),
        window(3029, 'round', '3'),
        bailout('needsPlan', 94),
        window(3059, 'round', '3'),
      ],
      NAMES,
    );
    expect(report.stints.map((s) => [s.name, s.afterWarmUp])).toEqual([
      ['dodgeInto', false],
      ['needsPlan', true],
    ]);
    const none = parseTrace([window(2069, 'round', '2')], NAMES);
    expect(none.warmUpEnd).toBeNull();
    expect(none.matchEnd).toBeNull();
  });
});

describe('botsNames', () => {
  test('takes the function and const names of the bots sources, and marks the ones the others share', () => {
    const names = botsNames(
      [
        'export function decide(): void {}\nfunction needsPlan() {}\nexport const chooseCast = (a: number) => a;',
        'const hasStatus = 1; const BIG = 2;',
      ],
      ['export function hasStatus() {}\nfunction stepSim() {}', 'class X { think() {} }'],
    );
    expect([...names.bots].sort()).toEqual(['BIG', 'chooseCast', 'decide', 'hasStatus', 'inspect', 'needsPlan', 'think']);
    expect([...names.ambiguous].sort()).toEqual(['hasStatus', 'think']);
  });
});

describe('formatReport', () => {
  test('prints one stint as one line under its function', () => {
    const report = parseTrace(
      [bailout('segmentHitsBox', 228), window(209), compiled('segmentHitsBox', 'TURBOFAN_JS'), window(239), window(4289, 'matchEnd', '3')],
      NAMES,
    );
    const text = formatReport(report);
    expect(text).toContain('segmentHitsBox\n  deopt-eager @228 wrong map: drop 209, back 239 in TURBOFAN_JS (30 ticks)\n');
  });

  test('prints an open stint to the match end, the legend, and the summary of drops after the warm-up', () => {
    const report = parseTrace(
      [
        window(2069, 'round', '2'),
        window(2999, 'round', '2'),
        window(3029, 'round', '3'),
        bailout('hasStatus', 7),
        window(3059, 'round', '3'),
        window(4289, 'matchEnd', '3'),
      ],
      NAMES,
    );
    const text = formatReport(report);
    expect(text).toContain('hasStatus*\n  deopt-eager @7 wrong map: drop 3059, open to the match end at 4289 (1230 ticks)\n');
    expect(text).toContain('"open" means no compile line');
    expect(text).toContain('Drops after the warm-up end 3029: hasStatus* @7 at 3059');
  });

  test('says none when no drop begins after the warm-up end', () => {
    const report = parseTrace([window(2069, 'round', '2'), bailout('dodgeInto', 806), window(2999, 'round', '2'), window(3029, 'round', '3')], NAMES);
    expect(formatReport(report)).toContain('Drops after the warm-up end 3029: none');
  });
});
