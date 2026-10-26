import { describe, expect, it } from 'vitest';
import { createFakeTransport } from './fake-transport';

describe('the fake transport', () => {
  it('records what is sent, in order, and counts the closes', () => {
    const fake = createFakeTransport();
    fake.send('a');
    fake.send('b');
    fake.close();
    expect(fake.sent).toEqual(['a', 'b']);
    expect(fake.closes).toBe(1);
  });

  it('runs the handlers synchronously, on open, deliver and close', () => {
    const fake = createFakeTransport();
    const log: string[] = [];
    fake.setHandlers({
      open: () => log.push('open'),
      message: (text) => log.push(`message ${text}`),
      closed: () => log.push('closed'),
    });
    fake.open();
    fake.deliver('x');
    fake.close();
    expect(log).toEqual(['open', 'message x', 'closed']);
  });

  it('drops an event when no handlers are set', () => {
    const fake = createFakeTransport();
    expect(() => {
      fake.open();
      fake.deliver('x');
    }).not.toThrow();
  });
});
