import { test, expect } from '../../helpers/fixtures';
import { memberPriceOf, parseMoney } from '../../helpers/money';
import {
  COLLECTIONS,
  FREE_FOR_MEMBERS,
  GROUPS,
  MARKETS,
  MEMBER_DISCOUNTED,
  MEMBER_PRICE_RATE,
  MEMBERSHIP_PRODUCT,
  TEXT,
} from '../../test-data/store';

/**
 * MEM-001, 002, 005, 009, 011 — "free for members" pricing as seen by a guest
 * (snippets/price.liquid, blocks/buy-buttons.liquid, blocks/add-to-cart.liquid — DAO-32).
 * Member-side cases are in active-member.spec.ts (needs the saved member session).
 */

const PRICE_WITH_AMOUNT = /\d/;

test.describe('Member pricing — guest view', () => {
  for (const { handle, market } of FREE_FOR_MEMBERS) {
    test(`MEM-001 guest sees the regular price on ${handle} (${market.country})`, async ({ store }) => {
      await store.openProduct(handle, market);

      await expect(store.pdpPrice).toBeVisible();
      await expect(store.pdpPrice).toHaveText(PRICE_WITH_AMOUNT);
      await expect(store.pdpPrice).not.toHaveText(TEXT.free);
      await expect(store.pdpCompareAtPrice).toHaveCount(0);
    });
  }

  for (const { handle, market } of FREE_FOR_MEMBERS) {
    test(`MEM-011 guest sees "Member price: Free" + upsell on ${handle} (${market.country})`, async ({ store }) => {
      await store.openProduct(handle, market);
      const price = await store.productPrice(handle);

      await expect(store.memberPriceNote).toContainText('💡');
      expect(await store.memberPriceValue('Member price')).toMatch(TEXT.free);
      expect(parseMoney(await store.memberPriceValue('Regular price'))).toBe(price);
      await expect(store.memberPriceNote.locator('a[href*="/products/daosense-membership"]')).toBeVisible();
    });
  }

  for (const { handle, market } of MEMBER_DISCOUNTED) {
    test(`MEM-011 guest sees "Member price" (67%) + upsell on ${handle} (${market.country})`, async ({ store }) => {
      await store.openProduct(handle, market);
      const price = await store.productPrice(handle);

      expect(parseMoney(await store.pdpPrice.innerText()), 'main PDP price = regular price').toBe(price);
      await expect(store.memberPriceNote).toContainText('💡');
      expect(parseMoney(await store.memberPriceValue('Member price'))).toBe(memberPriceOf(price, MEMBER_PRICE_RATE));
      expect(parseMoney(await store.memberPriceValue('Regular price'))).toBe(price);
      await expect(store.memberPriceNote.locator('a[href*="/products/daosense-membership"]')).toBeVisible();
    });
  }

  test('MEM-002 guest sees the regular price in search and collection cards', async ({ page, store }) => {
    const handle = GROUPS.foundations.en;
    const cardPrice = () =>
      page
        .locator('product-card')
        .filter({ has: page.locator(`a[href*="/products/${handle}"]`) })
        .first()
        .locator('.price')
        .first();

    for (const path of [
      `/search?q=${handle}&type=product`,
      `/collections/${COLLECTIONS.workbooks}`,
      `/collections/${COLLECTIONS.allEn}`,
    ]) {
      const [pathname, query] = path.split('?');
      await store.open(pathname, 'GB', Object.fromEntries(new URLSearchParams(query || '')));

      await expect(cardPrice(), `card price on ${pathname}`).toHaveText(PRICE_WITH_AMOUNT);
      await expect(cardPrice()).not.toHaveText(TEXT.free);
    }
  });

  for (const market of [MARKETS.GB, MARKETS.DE, MARKETS.SE]) {
    test(`MEM-005 the membership product is never shown as free (${market.country})`, async ({ store }) => {
      // Same handle in every market: /products/…, /de/products/…, /sv/products/daosense-membership
      await store.openProduct(MEMBERSHIP_PRODUCT, market);

      await expect(store.pdpPrice).toHaveText(PRICE_WITH_AMOUNT);
      await expect(store.pdpPrice).not.toHaveText(TEXT.free);
      await expect(store.memberPriceNote, 'no "Member price" block on the membership itself').toHaveCount(0);
    });
  }

  test('MEM-009 guest can add the membership to the cart', async ({ page, store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.openProduct(MEMBERSHIP_PRODUCT, 'GB');

    await expect(page.locator('[data-pdp-market-input]')).toHaveCount(0);
    await expect(store.pdpAddButton).toBeEnabled();
    await store.pdpAddButton.click();

    await expect
      .poll(async () => (await store.cart()).items.map((i) => i.handle))
      .toContain(MEMBERSHIP_PRODUCT);
  });
});
