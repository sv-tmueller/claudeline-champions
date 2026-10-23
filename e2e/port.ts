// The one port the dev server (packages/client/vite.config.ts), Playwright
// (playwright.config.ts) and the heap probe tests (tests/heap-probe.test.ts)
// share. CLAUDELINE_PORT picks it, so two checkouts can run the e2e suite at
// once. Unset means 5173, which is what CI uses. Any other value that is not a
// plain decimal port from 1024 to 65535 throws: a typo must not fall back to a
// port another session holds. No imports, so every config can load it.

export const PORT_VARIABLE = 'CLAUDELINE_PORT';
export const DEFAULT_PORT = 5173;
export const HOST = '127.0.0.1';

export function readPort(env: Record<string, string | undefined> = process.env): number {
  const value = env[PORT_VARIABLE];
  if (value === undefined) return DEFAULT_PORT;
  const port = /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1024 && port <= 65535)) {
    throw new Error(`${PORT_VARIABLE} must be a port from 1024 to 65535, got ${JSON.stringify(value)}`);
  }
  return port;
}

export function originOf(port: number): string {
  return `http://${HOST}:${port}`;
}
