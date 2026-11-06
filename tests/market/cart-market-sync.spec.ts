import { test, expect } from '../../helpers/fixtures';
import { GROUPS, TEXT, UNMAPPED_EN_PRODUCT } from '../../test-data/store';

/**
 * MKT-020…022, 028, 030 — cart re-sync after a market switch
 * (assets/cart-market-validation.js, assets/language-redirect.js — DAO-40 / DAO-42).
 */
test.describe('Cart sync on market switch', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.waitForCartSync();
  });

  test('MKT-020 item is swapped to its equivalent, quantity and properties kept', async ({ page, store }) => {
    const group = GROUPS.foundations;
    await store.addProduct(group.en, 2, { Gift: 'yes' });

    await store.open('/cart', 'SE');
    await store.waitForCartSync();

    const cart = await store.cart();
    expect(cart.items.map((i) => [i.handle, i.quantity])).toEqual([[group.sv, 2]]);
    expect(cart.items[0].properties).toMatchObject({ Gift: 'yes', _language: 'sv' });
    expect(cart.currency).toBe('SEK');

    await expect(store.notices.filter({ hasText: TEXT.itemSwitched.sv })).toBeVisible();
    await expect(page.locator('cart-icon')).toContainText('2');
  });

  test('MKT-021 item without an equivalent is removed with a notice', async ({ store }) => {
    await store.addProduct(UNMAPPED_EN_PRODUCT, 1);

    await store.open('/cart', 'DE');
    await store.waitForCartSync();

    expect((await store.cart()).items.map((i) => i.handle)).not.toContain(UNMAPPED_EN_PRODUCT);
    await expect(store.notices.filter({ hasText: TEXT.itemRemoved.de })).toBeVisible();
  });

  test('MKT-022 several swapped items produce one plural notice', async ({ store }) => {
    await store.addProduct(GROUPS.foundations.en, 1);
    await store.addProduct(GROUPS.october2025.en, 1);

    await store.open('/cart', 'DE');
    await store.waitForCartSync();

    expect((await store.cart()).items.map((i) => i.handle).sort()).toEqual(
      [GROUPS.foundations.de, GROUPS.october2025.de].sort()
    );
    await expect(store.notices.filter({ hasText: TEXT.itemsSwitched(2).de })).toHaveCount(1);
  });

  test('MKT-028 adding a product whose sibling is in the cart sums the quantity', async ({ store }) => {
    const group = GROUPS.foundations;
    await store.addProduct(group.en, 2);

    await store.openProduct(group.en, 'GB');
    await store.switchLanguageAndAdd('de');
    await store.waitForPath(`/de/products/${group.de}`, 'DE');
    await store.waitForCartSync();

    await expect
      .poll(async () => (await store.cart()).items.map((i) => [i.handle, i.quantity]))
      .toEqual([[group.de, 3]]);
  });

  test('MKT-030 a failed re-add during the swap does not silently lose the item', async ({ page, store }) => {
    // Known risk R-07: the old line is removed before the new one is added. Expected to fail until fixed.
    test.info().annotations.push({ type: 'known-risk', description: 'R-07' });
    await store.addProduct(GROUPS.foundations.en, 1);

    await page.route('**/cart/add.js', (route) => route.abort('failed'));
    await store.open('/cart', 'DE');
    await store.waitForCartSync();
    await page.unroute('**/cart/add.js');

    const cart = await store.cart();
    const notified = await store.notices.count();
    expect(
      cart.item_count > 0 || notified > 0,
      'item should stay in the cart, or the shopper should be told it was removed'
    ).toBe(true);
  });
});
