import { test, expect } from '../../helpers/fixtures';
import { CUSTOMER_STORAGE_STATE, hasCustomerSession } from '../../helpers/auth';
import { parseMoney } from '../../helpers/money';
import { FREE_FOR_MEMBERS, TEXT } from '../../test-data/store';

/**
 * Logged-in customer WITHOUT membership — MEM-007, ACC-009, ACC-013.
 * Needs the session saved by `npm run auth:customer`; skipped otherwise.
 */

test.use({ storageState: hasCustomerSession() ? CUSTOMER_STORAGE_STATE : undefined });

test.describe('Customer without membership', () => {
  test.skip(!hasCustomerSession(), 'No customer session — run `npm run auth:customer` first');

  for (const { handle, market } of FREE_FOR_MEMBERS) {
    test(`MEM-007 non-member sees the regular price and "Your price" on ${handle} (${market.country})`, async ({ store }) => {
      await store.openProduct(handle, market);
      const price = await store.productPrice(handle);

      await expect(store.pdpPrice).not.toHaveText(TEXT.free);
      await expect(store.pdpCompareAtPrice).toHaveCount(0);
      // logged-in non-member variant of the Member price block
      await expect(store.memberPriceNote).toContainText('💡');
      expect(await store.memberPriceValue('Your price')).toMatch(/\d/);
      expect(parseMoney(await store.memberPriceValue('Your price'))).toBe(price);
      await expect(store.memberPriceNote.locator('a[href*="/products/daosense-membership"]')).toBeVisible();
    });
  }

  test('ACC-009 non-member does not see the member blocks in the members area', async ({ page, store }) => {
    await store.open('/pages/members-area', 'GB');
    await expect(page.locator('h1.main_heading')).toHaveText(/^Hello/);
    await expect(page.locator('.account-actions__main-menu')).toHaveCount(0);
    await expect(page.locator('.your_membership')).toHaveCount(0);
    await expect(page.locator('.support_block')).toHaveCount(0);
  });

  for (const market of ['GB', 'US'] as const) {
    test(`ACC-013 no membership note on ${market}`, async ({ page, store }) => {
      await store.open('/pages/members-area', market);
      await expect(page.locator('.memebership_note')).toHaveCount(0);
    });
  }
});
