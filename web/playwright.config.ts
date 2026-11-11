import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:5175', channel: 'chrome', headless: true, serviceWorkers: 'block', screenshot: 'off', trace: 'off', video: 'off' },
  webServer: { command: 'npm run dev:verify -- --port 5175', url: 'http://127.0.0.1:5175', reuseExistingServer: false, timeout: 60_000 },
});
