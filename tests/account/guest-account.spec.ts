import { test, expect } from '../../helpers/fixtures';

/** ACC-016, ACC-017 — members area and account menu as a guest. */

test.describe('Account — guest', () => {
  for (const market of ['GB', 'DE'] as const) {
    test(`ACC-016 guest opening the members area by URL sees no member content (${market})`, async ({ page, store }) => {
      await store.open('/pages/members-area', market);

      // gating is server-side (Liquid): member blocks must not even be in the HTML
      const html = await page.content();
      expect(html, 'no member profile markup for guests').not.toContain('account-actions__main-menu');
      expect(html).not.toContain('your_membership');
      expect(html).not.toContain('support_block');
      await expect(page.locator('h1.main_heading')).toHaveCount(0);
    });
  }

  test('ACC-017 guest account menu offers Join and Sign in', async ({ page, store, isMobile }) => {
    test.skip(!!isMobile, 'desktop account popover');
    await store.open('/', 'GB');
    await store.accountButton.click();
    await expect(store.accountPopover).toBeVisible();

    const join = store.accountPopover.locator('a[href*="/products/daosense-membership"]').first();
    const signIn = store.accountPopover.locator('a[href*="/account"]').first();
    await expect(join).toBeVisible();
    await expect(signIn).toBeVisible();

    await join.click();
    await page.waitForURL((u) => u.pathname === '/products/daosense-membership');
  });
});
