const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Retries must not hide an intermittent compatibility failure in the daily run.
  retries: 0,
  timeout: 120_000,
  globalTimeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
});
