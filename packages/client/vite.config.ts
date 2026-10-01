import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works under any base path (spec section 5).
  base: './',
  // Pinned so `npm run dev` needs no forwarded CLI args and Playwright knows the URL.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
