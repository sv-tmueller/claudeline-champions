import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { HOST, readPort } from '../../e2e/port';

export default defineConfig({
  // Relative asset paths, so the build works under any base path (spec section 5).
  base: './',
  // The generated models live in the repo-root assets/ folder. Resolved from
  // this file because Vite resolves a relative publicDir against the cwd.
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  // The port comes from CLAUDELINE_PORT through e2e/port.ts, which Playwright
  // reads too, so `npm run dev` needs no forwarded CLI args and Playwright knows
  // the URL. A port already in use is an error, never a silent move.
  server: { host: HOST, port: readPort(), strictPort: true },
});
