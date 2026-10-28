const { test, expect } = require('./fixtures');
const {
  openVideo, expectPlacement, expectSaved, commentsHeight, pressBrowserShortcut,
} = require('./youtube');

for (const placement of ['sidebar', 'default']) {
  test.describe(`saved placement: ${placement}`, () => {
    test.use({ savedPlacement: placement });

    test('loads the extension and restores the saved placement', async ({ extension }) => {
      const { page } = extension;
      await openVideo(page);
      await expectPlacement(page, placement);
      await expect(page.locator('#sidesy-toggle-btn')).toHaveCount(1);
      await expect(page.locator('#comments > .comments-header')).toHaveCount(1);
    });
  });
}

test('position button toggles both ways and remembers the last position after reload', async ({ extension }) => {
  const { page, worker } = extension;
  await openVideo(page);
  await expectPlacement(page, 'sidebar');

  for (const placement of ['default', 'sidebar']) {
    await page.locator('#sidesy-toggle-btn').click();
    await expectPlacement(page, placement);
    await expectSaved(worker, 'comments_placement', placement);
    await openVideo(page);
    await expectPlacement(page, placement);
  }
});

test('registered Chrome shortcut toggles the active YouTube tab both ways', async ({ extension }, testInfo) => {
  test.skip(process.platform !== 'linux', 'Native browser shortcut coverage runs on Linux/Xvfb in GitHub Actions.');
  const { page, worker } = extension;
  const command = await worker.evaluate(async () => (
    (await chrome.commands.getAll()).find(({ name }) => name === 'toggle-sidebar')
  ));
  // A fresh profile should register the default shortcut from the real manifest.
  // A missing registration is a failure, not silently skipped coverage.
  expect(command?.shortcut, 'Chrome must register the configured position shortcut').toBeTruthy();
  testInfo.annotations.push({ type: 'Chrome shortcut', description: command.shortcut });

  await openVideo(page);
  await expectPlacement(page, 'sidebar');
  for (const placement of ['default', 'sidebar']) {
    await pressBrowserShortcut(page, command.shortcut);
    await expectPlacement(page, placement);
    await expectSaved(worker, 'comments_placement', placement);
  }
});

test('expand/collapse button changes comments height and saves expanded state', async ({ extension }) => {
  const { page, worker } = extension;
  await openVideo(page);
  await expectPlacement(page, 'sidebar');
  const button = page.locator('#sidesy-expand-comments-btn');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  const collapsedHeight = await commentsHeight(page);

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => commentsHeight(page)).toBeGreaterThan(collapsedHeight + 20);
  await expectSaved(worker, 'sidebar_comments_expanded', true);

  await openVideo(page);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => Math.abs((await commentsHeight(page)) - collapsedHeight)).toBeLessThan(2);
  await expectSaved(worker, 'sidebar_comments_expanded', false);
});

test('Z expands/collapses comments and ignores editable fields and default placement', async ({ extension }) => {
  const { page, worker } = extension;
  await openVideo(page);
  await expectPlacement(page, 'sidebar');
  const button = page.locator('#sidesy-expand-comments-btn');
  const collapsedHeight = await commentsHeight(page);

  await page.locator('#sidesy-toggle-btn').focus();
  await page.keyboard.press('z');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => commentsHeight(page)).toBeGreaterThan(collapsedHeight + 20);
  await expectSaved(worker, 'sidebar_comments_expanded', true);
  await page.keyboard.press('z');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => Math.abs((await commentsHeight(page)) - collapsedHeight)).toBeLessThan(2);
  await expectSaved(worker, 'sidebar_comments_expanded', false);

  const search = page.getByRole('combobox', { name: 'Search', exact: true });
  await search.fill('');
  await search.press('z');
  await expect(search).toHaveValue('z');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await search.press('Escape');

  await page.locator('#sidesy-toggle-btn').click();
  await expectPlacement(page, 'default');
  await page.locator('#sidesy-toggle-btn').focus();
  await page.keyboard.press('z');
  await expectSaved(worker, 'sidebar_comments_expanded', false);
  await expect(button).toBeHidden();
});
