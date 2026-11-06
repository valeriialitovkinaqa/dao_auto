import { test, expect } from '../../helpers/fixtures';
import { GROUPS, TEXT } from '../../test-data/store';

/**
 * MKT-026…027 — CartMax bundles on market switch (assets/cart-market-validation.js — DAO-40).
 * Bundles are simulated by adding lines with the `__CartMax_Recommendations` property the CartMax
 * app writes, so the tests do not depend on the app UI. The auto-click of the CartMax button after
 * "re-add" needs the real app widget and is covered only when it is rendered on the page.
 */

const bundleProps = (configId: number, isMain: boolean) => ({
  __CartMax_Recommendations: JSON.stringify({ config_id: configId, ai: { is_main: isMain } }),
});

test.describe('CartMax bundles on market switch', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.waitForCartSync();
  });

  test('MKT-026 one bundle is removed as a whole and offers a re-add link', async ({ page, store }) => {
    await store.addToCart([
      { id: await store.variantId(GROUPS.foundations.en), quantity: 1, properties: bundleProps(101, true) },
      { id: await store.variantId(GROUPS.october2025.en), quantity: 1, properties: bundleProps(101, false) },
    ]);

    await store.open('/', 'SE');
    await store.waitForCartSync();

    expect((await store.cart()).item_count).toBe(0);
    const notice = store.notices.filter({ hasText: TEXT.bundleRemoved.sv });
    await expect(notice).toBeVisible();

    const link = notice.locator('a');
    await expect(link).toHaveAttribute('href', new RegExp(`/products/${GROUPS.foundations.sv}\\?cartmax_readd=1`));

    // Known risk R-08: the link has no /sv prefix — check the shopper still lands in Swedish.
    await link.click();
    await page.waitForLoadState('load');
    await expect.poll(() => new URL(page.url()).searchParams.has('cartmax_readd')).toBe(false);
    expect((await store.state()).locale, 're-add page should stay in Swedish').toBe('sv');
  });

  test('MKT-027 two bundles are both removed and the notice has no link', async ({ store }) => {
    await store.addToCart([
      { id: await store.variantId(GROUPS.foundations.en), quantity: 1, properties: bundleProps(201, true) },
      { id: await store.variantId(GROUPS.october2025.en), quantity: 1, properties: bundleProps(202, true) },
    ]);

    await store.open('/', 'DE');
    await store.waitForCartSync();

    expect((await store.cart()).item_count).toBe(0);
    const notice = store.notices.filter({ hasText: TEXT.bundleRemoved.de });
    await expect(notice).toBeVisible();
    await expect(notice.locator('a')).toHaveCount(0);
  });
});
