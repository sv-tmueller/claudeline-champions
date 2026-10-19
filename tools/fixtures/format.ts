import type { Entry, Fixture } from '../../packages/sim/test/roster-fixture.ts';

// Writes a fixture in the layout of the committed scripted roster fixtures, byte for byte: two
// spaces of indent, the keys in the order format, arena, seed, config, ticks, segments, actions,
// checkpoints, checksum, one player, segment, action or checkpoint per line with its inputs as
// compact arrays, and one newline at the end. Nothing in it depends on the time or the platform.

function entry(e: Entry): string {
  return e === null ? 'null' : `[${e.join(',')}]`;
}

function list(lines: string[]): string {
  return lines.length === 0 ? '[]' : `[\n${lines.map((line) => `    ${line}`).join(',\n')}\n  ]`;
}

export function formatFixture(fixture: Fixture): string {
  const players = fixture.config.players.map(
    (p) => `      {"championId": ${JSON.stringify(p.championId)}, "team": ${JSON.stringify(p.team)}}`,
  );
  const segments = fixture.segments.map(
    (s) => `{ "ticks": ${s.ticks}, "inputs": [${s.inputs.map(entry).join(',')}] }`,
  );
  const actions = fixture.actions.map(
    (a) =>
      `{ "tick": ${a.tick}, "type": ${JSON.stringify(a.type)}, "spec": { "championId": ${a.spec.championId}, "energy": ${a.spec.energy} } }`,
  );
  const checkpoints = fixture.checkpoints.map((c) => `{ "tick": ${c.tick}, "checksum": ${c.checksum} }`);
  return [
    '{',
    `  "format": ${fixture.format},`,
    `  "arena": ${JSON.stringify(fixture.arena)},`,
    `  "seed": ${fixture.seed},`,
    '  "config": {',
    `    "teamSize": ${fixture.config.teamSize},`,
    `    "players": [\n${players.join(',\n')}\n    ]`,
    '  },',
    `  "ticks": ${fixture.ticks},`,
    `  "segments": ${list(segments)},`,
    `  "actions": ${list(actions)},`,
    `  "checkpoints": ${list(checkpoints)},`,
    `  "checksum": ${fixture.checksum}`,
    '}',
    '',
  ].join('\n');
}
