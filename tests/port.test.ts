import { describe, expect, it } from 'vitest';
import { PORT_VARIABLE, originOf, readPort } from '../e2e/port';

// The one port the dev server, Playwright and the heap probe tests share
// (e2e/port.ts). CI never sets CLAUDELINE_PORT, so these tests pin the default
// and the validation that a seat's own port goes through.

describe('readPort', () => {
  it('gives 5173 when the variable is unset', () => {
    expect(readPort({})).toBe(5173);
  });

  it('reads a decimal port', () => {
    expect(readPort({ [PORT_VARIABLE]: '6172' })).toBe(6172);
  });

  it('accepts the ends of the range', () => {
    expect(readPort({ [PORT_VARIABLE]: '1024' })).toBe(1024);
    expect(readPort({ [PORT_VARIABLE]: '65535' })).toBe(65535);
  });

  it.each(['', ' ', ' 6172', '6172 ', '+6172', '-6172', '1e4', '6172x', 'abc', '0x1800', '61.72', '0', '80', '1023', '65536', '70000'])(
    'throws for %j, naming the variable and the quoted value',
    (value) => {
      expect(() => readPort({ [PORT_VARIABLE]: value })).toThrow(
        new Error(`${PORT_VARIABLE} must be a port from 1024 to 65535, got ${JSON.stringify(value)}`),
      );
    },
  );
});

describe('originOf', () => {
  it('builds the loopback origin with no trailing slash', () => {
    expect(originOf(readPort({}))).toBe('http://127.0.0.1:5173');
    expect(originOf(6172)).toBe('http://127.0.0.1:6172');
  });
});
