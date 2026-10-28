const { expect } = require('@playwright/test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
// A short public video with comments enabled. Override if it becomes unavailable.
const videoUrl = process.env.YOUTUBE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=jNQXAC9IVRw&hl=en';

async function openVideo(page) {
  await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const consent = page.getByRole('button', { name: /^(Reject all|Accept all)$/ }).first();
  const watchPage = page.locator('ytd-watch-flexy');
  await expect.poll(async () => (
    await consent.isVisible() || await watchPage.isVisible()
  ), { timeout: 30_000, message: 'YouTube must show a watch page or its consent dialog' }).toBe(true);
  if (await consent.isVisible()) await consent.click();

  await expect(watchPage, 'YouTube watch page is unavailable or blocked').toBeVisible();
  await expect(page.locator('.html5-main-video')).toBeVisible();
  await page.locator('.html5-main-video').evaluate((video) => video.pause());
  const metadata = page.locator('ytd-watch-metadata');
  await expect(metadata).toBeVisible();

  // A single early wheel event can occur before YouTube's layout is ready.
  // Scroll around the metadata until lazy comments initialize, keeping the
  // pointer in the main column rather than scrolling a sidebar container.
  await expect.poll(async () => {
    if (await page.locator('#sidesy-toggle-btn').isVisible()) return true;
    await metadata.scrollIntoViewIfNeeded();
    await page.mouse.move(400, 500);
    await page.mouse.wheel(0, 500);
    return page.locator('#sidesy-toggle-btn').isVisible();
  }, {
    timeout: 45_000,
    intervals: [500, 1_000],
    message: 'Sidesy did not activate on live YouTube: inspect the trace and DOM for disabled comments, a blocked page, or selector changes',
  }).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
}

async function expectPlacement(page, placement) {
  const comments = page.locator('#comments.extension-control');
  await expect(comments).toBeVisible();
  if (placement === 'sidebar') {
    await expect(page.locator('#secondary-inner > #comments.popout')).toBeVisible();
    await expect(page.locator('#sidesy-expand-comments-btn')).toBeVisible();
  } else {
    await expect(page.locator('#below > #comments.extension-control')).toBeVisible();
    await expect(comments).not.toHaveClass(/\bpopout\b/);
    await expect(page.locator('#sidesy-expand-comments-btn')).toBeHidden();
  }
}

async function expectSaved(worker, key, value) {
  await expect.poll(() => worker.evaluate(async (storageKey) => (
    (await chrome.storage.local.get(storageKey))[storageKey]
  ), key)).toBe(value);
}

async function commentsHeight(page) {
  return page.locator('#comments.extension-control').evaluate((comments) => (
    comments.getBoundingClientRect().height
  ));
}

async function pressBrowserShortcut(page, shortcut) {
  // CDP/page.keyboard events do not exercise Chrome's browser-level command
  // accelerators. Use actual X11 input in the isolated headed CI browser.
  if (process.platform !== 'linux' || !process.env.DISPLAY) {
    throw new Error('Browser shortcut E2E requires Linux with DISPLAY and xdotool (use xvfb-run).');
  }
  const keys = shortcut.split('+').map((part) => {
    const modifiers = { Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift' };
    if (modifiers[part]) return modifiers[part];
    if (/^[A-Z0-9]$/.test(part)) return part.toLowerCase();
    throw new Error(`Unsupported Chrome shortcut key: ${part}`);
  }).join('+');

  await page.bringToFront();
  await page.locator('#sidesy-toggle-btn').focus();
  const { stdout } = await run('xdotool', ['search', '--onlyvisible', '--class', '^sidesy-e2e$'], { timeout: 10_000 });
  const windows = stdout.trim().split(/\s+/).filter(Boolean);
  if (windows.length !== 1) {
    throw new Error(`Expected one isolated Chromium window, found ${windows.length}.`);
  }
  await run('xdotool', ['windowfocus', '--sync', windows[0]], { timeout: 10_000 });
  await run('xdotool', ['key', '--clearmodifiers', keys], { timeout: 10_000 });
}

module.exports = {
  openVideo, expectPlacement, expectSaved, commentsHeight, pressBrowserShortcut,
};
