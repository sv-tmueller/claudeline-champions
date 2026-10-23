import { defineConfig, devices } from '@playwright/test';
import { originOf, readPort } from './e2e/port';

// CLAUDELINE_PORT (default 5173) is read here and by the Vite config, which
// Playwright's webServer starts with this environment inherited.
const origin = originOf(readPort());

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: origin,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: 'npm run dev',
    url: origin,
    reuseExistingServer: !process.env['CI'],
  },
});
