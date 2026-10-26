import type { Transport, TransportHandlers } from './transport';

// A transport for tests: it records what the net core sends and lets a test push the server's
// texts in, synchronously, with no timer. A test-only module, which no client code imports.

export interface FakeTransport extends Transport {
  /** Every text sent, in order. */
  readonly sent: string[];
  /** How many times `close` was called. */
  closes: number;
  /** The socket opened. */
  open(): void;
  /** A server text arrives. */
  deliver(text: string): void;
}

export function createFakeTransport(): FakeTransport {
  let handlers: TransportHandlers | null = null;
  const fake: FakeTransport = {
    sent: [],
    closes: 0,
    send(text) {
      fake.sent.push(text);
    },
    close() {
      fake.closes += 1;
      handlers?.closed();
    },
    setHandlers(next) {
      handlers = next;
    },
    open() {
      handlers?.open();
    },
    deliver(text) {
      handlers?.message(text);
    },
  };
  return fake;
}
