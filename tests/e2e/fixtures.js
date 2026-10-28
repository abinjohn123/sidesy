const { test: base, expect, chromium } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const extensionPath = path.resolve(__dirname, '../..');

const test = base.extend({
  savedPlacement: ['sidebar', { option: true }],

  extension: async ({ savedPlacement }, use, testInfo) => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'sidesy-e2e-'));
    let context;
    let page;
    const browserLog = [];

    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: process.env.E2E_HEADLESS === '1',
        viewport: { width: 1440, height: 1000 },
        locale: 'en-US',
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          ...(process.platform === 'linux' ? ['--ozone-platform=x11', '--class=sidesy-e2e'] : []),
        ],
      });
      // Persistent contexts are created outside Playwright's normal page fixture,
      // so explicitly record their traces and failure artifacts.
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const worker = context.serviceWorkers().find((candidate) => (
        candidate.url().startsWith('chrome-extension://')
      )) ?? await context.waitForEvent('serviceworker', {
        predicate: (candidate) => candidate.url().startsWith('chrome-extension://'),
        timeout: 30_000,
      });

      await expect.poll(() => worker.evaluate(async () => (
        Number.isFinite((await chrome.storage.local.get('extension_installed_at')).extension_installed_at)
      )), { message: 'The real extension installation must complete' }).toBe(true);

      await worker.evaluate(async (placement) => {
        await chrome.storage.local.set({
          comments_placement: placement,
          sidebar_comments_expanded: false,
          pending_announcement: null,
        });
      }, savedPlacement);

      page = await context.newPage();
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) {
          browserLog.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => browserLog.push(`pageerror: ${error.stack}`));

      // Installation opens Sidesy's welcome page. Keep a single tab/window so
      // Chrome commands are delivered to the YouTube tab under test.
      for (const other of context.pages()) {
        if (other !== page) await other.close();
      }
      await use({ context, page, worker });
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (context) {
        try {
          if (failed && page && !page.isClosed()) {
            await testInfo.attach('page', {
              body: await page.screenshot({ timeout: 10_000 }),
              contentType: 'image/png',
            });
            await testInfo.attach('live-dom', {
              body: await page.content(),
              contentType: 'text/html',
            });
            await testInfo.attach('browser-log', {
              body: JSON.stringify({ url: page.url(), messages: browserLog }, null, 2),
              contentType: 'application/json',
            });
          }
        } finally {
          try {
            if (failed) {
              const tracePath = testInfo.outputPath('trace.zip');
              await context.tracing.stop({ path: tracePath });
              await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' });
            } else {
              await context.tracing.stop();
            }
          } finally {
            await context.close();
          }
        }
      }
      await rm(profile, { recursive: true, force: true });
    }
  },
});

module.exports = { test, expect };
