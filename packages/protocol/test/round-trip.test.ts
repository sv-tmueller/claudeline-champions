import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeFirstMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from '../src/codec';
import { clientMessages, firstMessages, goldens, serverMessages, sessionMessages } from './samples';

/** Reverses the key order of every record the codec knows, and leaves the opaque parts alone. */
function reverseKeys(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => reverseKeys(item, path));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value).reverse()) {
    const at = path === '' ? key : `${path}.${key}`;
    const opaque = at === 'state' || at === 'arena' || at === 'kits' || at === 'events.events';
    out[key] = opaque ? inner : reverseKeys(inner, at);
  }
  return out;
}

describe('round trips', () => {
  it.each(firstMessages)('$t: decodeFirstMessage gives back what encodeClientMessage wrote', (m) => {
    expect(decodeFirstMessage(encodeClientMessage(m))).toEqual({ ok: true, message: m });
  });

  it.each(sessionMessages)('$t: decodeClientMessage gives back what encodeClientMessage wrote', (m) => {
    expect(decodeClientMessage(encodeClientMessage(m))).toEqual({ ok: true, message: m });
  });

  it.each(serverMessages)('$t: decodeServerMessage gives back what encodeServerMessage wrote', (m) => {
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual({ ok: true, message: m });
  });

  it('keeps an absent roundsToWin absent in matchStart', () => {
    const start = serverMessages.find((m) => m.t === 'matchStart');
    if (start === undefined || start.t !== 'matchStart') throw new Error('sample missing');
    const free = { ...start, config: { teamSize: start.config.teamSize, players: start.config.players } };
    const decoded = decodeServerMessage(encodeServerMessage(free));
    expect(decoded).toEqual({ ok: true, message: free });
    if (decoded.ok && decoded.message.t === 'matchStart') {
      expect(Object.hasOwn(decoded.message.config, 'roundsToWin')).toBe(false);
    }
  });

  it('round trips matchStart with an energyOrb after roundsToWin, and keeps the golden text without it', () => {
    const start = serverMessages.find((m) => m.t === 'matchStart');
    if (start === undefined || start.t !== 'matchStart') throw new Error('sample missing');
    const withOrb = { ...start, config: { ...start.config, energyOrb: { x: 0, y: 2.5 } } };
    const text = encodeServerMessage(withOrb);
    expect(text).toContain('"roundsToWin":3,"energyOrb":{"x":0,"y":2.5}}');
    const decoded = decodeServerMessage(text);
    expect(decoded).toEqual({ ok: true, message: withOrb });
    if (decoded.ok && decoded.message.t === 'matchStart') {
      expect(Object.keys(decoded.message.config)).toEqual(['teamSize', 'players', 'roundsToWin', 'energyOrb']);
    }
    // Without the key the text is the committed golden and the key stays absent.
    const plain = encodeServerMessage(start);
    expect(plain).toBe(goldens.matchStart);
    expect(plain).not.toContain('energyOrb');
    const back = decodeServerMessage(plain);
    if (back.ok && back.message.t === 'matchStart') {
      expect(Object.hasOwn(back.message.config, 'energyOrb')).toBe(false);
    }
  });

  it('keeps energyOrb without roundsToWin, and writes a -0 coordinate as 0', () => {
    const start = serverMessages.find((m) => m.t === 'matchStart');
    if (start === undefined || start.t !== 'matchStart') throw new Error('sample missing');
    const config = { teamSize: start.config.teamSize, players: start.config.players, energyOrb: { x: -0, y: -2.5 } };
    const text = encodeServerMessage({ ...start, config });
    const decoded = decodeServerMessage(text);
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.t === 'matchStart') {
      const orb = decoded.message.config.energyOrb;
      expect(Object.is(orb?.x, 0)).toBe(true);
      expect(orb?.y).toBe(-2.5);
      expect(Object.hasOwn(decoded.message.config, 'roundsToWin')).toBe(false);
    }
  });

  it('round trips every error code', () => {
    for (const code of [
      'version',
      'badMessage',
      'roomNotFound',
      'roomFull',
      'matchRunning',
      'badToken',
      'notHost',
      'notInLobby',
      'teamFull',
    ] as const) {
      const m = { t: 'error', code, fatal: true } as const;
      expect(decodeServerMessage(encodeServerMessage(m))).toEqual({ ok: true, message: m });
    }
  });
});

describe('golden texts', () => {
  it('has one golden text for each of the sixteen types', () => {
    const types = [...clientMessages, ...serverMessages].map((m) => m.t);
    expect(types).toHaveLength(16);
    expect(Object.keys(goldens).sort()).toEqual([...types].sort());
  });

  it.each(clientMessages)('$t: the encoder writes the golden text', (m) => {
    expect(encodeClientMessage(m)).toBe(goldens[m.t]);
  });

  it.each(serverMessages)('$t: the encoder writes the golden text', (m) => {
    expect(encodeServerMessage(m)).toBe(goldens[m.t]);
  });

  it.each(firstMessages)('$t: encode(decode(golden)) is the golden text', (m) => {
    const decoded = decodeFirstMessage(goldens[m.t] ?? '');
    expect(decoded.ok && encodeClientMessage(decoded.message)).toBe(goldens[m.t]);
  });

  it.each(sessionMessages)('$t: encode(decode(golden)) is the golden text', (m) => {
    const decoded = decodeClientMessage(goldens[m.t] ?? '');
    expect(decoded.ok && encodeClientMessage(decoded.message)).toBe(goldens[m.t]);
  });

  it.each(serverMessages)('$t: encode(decode(golden)) is the golden text', (m) => {
    const decoded = decodeServerMessage(goldens[m.t] ?? '');
    expect(decoded.ok && encodeServerMessage(decoded.message)).toBe(goldens[m.t]);
  });
});

describe('the encoders ignore the caller key order and stray fields', () => {
  it.each(clientMessages)('$t: reversed key order gives the same client bytes', (m) => {
    const reversed = reverseKeys(m) as typeof m;
    // Non-vacuity: the reversal really changed the order.
    if (Object.keys(m).length > 1) expect(Object.keys(reversed)).not.toEqual(Object.keys(m));
    expect(encodeClientMessage(reversed)).toBe(goldens[m.t]);
  });

  it.each(serverMessages)('$t: reversed key order gives the same server bytes', (m) => {
    const reversed = reverseKeys(m) as typeof m;
    expect(Object.keys(reversed)).not.toEqual(Object.keys(m));
    expect(encodeServerMessage(reversed)).toBe(goldens[m.t]);
  });

  it.each(clientMessages)('$t: a stray field is not written', (m) => {
    expect(encodeClientMessage({ ...m, extra: 1 } as unknown as typeof m)).toBe(goldens[m.t]);
  });

  it.each(serverMessages)('$t: a stray field is not written', (m) => {
    expect(encodeServerMessage({ ...m, extra: 1 } as unknown as typeof m)).toBe(goldens[m.t]);
  });

  it('writes no stray field inside nested records either', () => {
    const input = { t: 'input', tick: 1, input: { moveX: 0, moveY: 0, aimX: 1, aimY: 2, buttons: 3, x: 1 } } as const;
    expect(encodeClientMessage(input)).toBe(
      '{"t":"input","tick":1,"input":{"moveX":0,"moveY":0,"aimX":1,"aimY":2,"buttons":3}}',
    );
  });
});
