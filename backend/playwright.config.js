const { defineConfig } = require('@playwright/test');

// Locally the installed Chrome is used (no browser download); CI installs Playwright's Chromium and sets PW_CHANNEL="".
const channel = process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL;
const port = process.env.E2E_PORT || '4010';

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, ...(channel ? { channel } : {}), trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/e2e-server.js', url: `http://127.0.0.1:${port}/health`, reuseExistingServer: false, timeout: 120000, env: { E2E_PORT: port } }
});
