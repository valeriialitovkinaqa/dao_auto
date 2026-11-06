import { test, expect } from '../../helpers/fixtures';
import { MEMBER_EMAIL, MEMBER_STORAGE_STATE, hasMemberSession } from '../../helpers/auth';
import { memberPriceOf, parseMoney } from '../../helpers/money';
import {
  FREE_FOR_MEMBERS,
  GROUPS,
  MARKETS,
  MEMBER_DISCOUNTED,
  MEMBER_PRICE_RATE,
  MEMBERSHIP_PRODUCT,
  SUPPORT_EMAIL,
  TEXT,
} from '../../test-data/store';

/**
 * Active member (customer tagged `active_subscription`) — member pricing and the members area.
 * MEM-003, 004, 005, 008, 010 · ACC-001, 002, 003, 005, 006, 007, 008, 018
 * (snippets/price.liquid, blocks/buy-buttons.liquid, sections/users-section.liquid, snippets/account-actions.liquid)
 *
 * Uses the session saved by `npm run auth:member` (manual login, the code comes by email).
 * The member's cart is a real, account-bound cart: every test empties it before and after.
 * Nothing here goes to checkout, cancels the subscription or logs out (that would kill the session).
 */

const MEMBERS_AREA = '/pages/members-area';
const PRICE_WITH_AMOUNT = /\d/;

test.use({ storageState: hasMemberSession() ? MEMBER_STORAGE_STATE : undefined });

test.describe('Active member', () => {
  test.skip(!hasMemberSession(), 'No member session — run `npm run auth:member` first');
  // Tests run one by one anyway (workers: 1). Not 'serial' mode: there one failure skips all the rest.

  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
  });

  test.afterEach(async ({ store }) => {
    await store.open('/', 'GB').catch(() => {});
    await store.clearCart().catch(() => {});
  });

  // ---------------- Member pricing ----------------
  // Free-for-members products → "Free". Every other product → "Member price" line = 67% of the price.

  for (const { handle, market } of FREE_FOR_MEMBERS) {
    test(`MEM-003 member sees "Free" on ${handle} (${market.country})`, async ({ store }) => {
      await store.openProduct(handle, market);

      // main price: Free + the regular price struck through
      await expect(store.pdpPrice).toHaveText(TEXT.free);
      await expect(store.pdpCompareAtPrice).toBeVisible();
      await expect(store.pdpCompareAtPrice).toHaveText(PRICE_WITH_AMOUNT);
      await expect(store.page.locator('main .volume-pricing-note')).toHaveCount(0);

      // "Member price" block: 💎 Member price: Free, no "buy membership" upsell for a member
      await expect(store.memberPriceNote).toContainText('💎');
      expect(await store.memberPriceValue('Member price')).toMatch(TEXT.free);
      await expect(store.memberPriceNote.locator('a[href*="daosense-membership"]')).toHaveCount(0);
    });
  }

  test('MEM-003 member sees "Free" on the product card in search', async ({ page, store }) => {
    const handle = GROUPS.foundations.en;
    await store.open('/search', 'GB', { q: handle, type: 'product' });

    const card = page.locator('product-card').filter({ has: page.locator(`a[href*="/products/${handle}"]`) }).first();
    await expect(card.locator('.price').first()).toHaveText(TEXT.free);
  });

  for (const { handle, market } of MEMBER_DISCOUNTED) {
    test(`MEM-010 member sees "Member price" (67%) + "Regular price" on ${handle} (${market.country})`, async ({ store }) => {
      await store.openProduct(handle, market);
      const price = await store.productPrice(handle);
      const memberPrice = memberPriceOf(price, MEMBER_PRICE_RATE);

      // main price stays the regular price — no "Free", nothing struck through
      expect(parseMoney(await store.pdpPrice.innerText()), 'main PDP price = regular price').toBe(price);
      await expect(store.pdpPrice).not.toHaveText(TEXT.free);

      // "Member price" block
      await expect(store.memberPriceNote).toContainText('💎');
      expect(parseMoney(await store.memberPriceValue('Member price')), 'Member price = price × 0.67').toBe(memberPrice);
      expect(parseMoney(await store.memberPriceValue('Regular price')), 'Regular price = product price').toBe(price);
      await expect(store.memberPriceNote.locator('a[href*="daosense-membership"]')).toHaveCount(0);
    });
  }

  test('MEM-004 a free-for-members product costs 0 in the cart', async ({ store }) => {
    await store.clearCart();
    await store.addProduct(GROUPS.foundations.en, 1);

    const line = (await store.cart()).items.find((i) => i.handle === GROUPS.foundations.en);
    expect(line, 'product should be in the cart').toBeTruthy();
    expect(line!.final_line_price, 'member should pay 0 for this product').toBe(0);
  });

  test('MEM-004 a regular product costs the Member price in the cart', async ({ store }) => {
    const handle = GROUPS.september.en;
    await store.clearCart();
    const memberPrice = memberPriceOf(await store.productPrice(handle), MEMBER_PRICE_RATE);
    await store.addProduct(handle, 1);

    const line = (await store.cart()).items.find((i) => i.handle === handle);
    expect(line, 'product should be in the cart').toBeTruthy();
    // ±1 minor unit: the theme rounds price × 0.67, the discount engine may round differently
    expect(Math.abs(line!.final_line_price - memberPrice), `cart price ${line!.final_line_price} ≈ Member price ${memberPrice}`).toBeLessThanOrEqual(1);
  });

  for (const market of [MARKETS.GB, MARKETS.DE, MARKETS.SE]) {
    test(`MEM-005 the membership product is not shown as free to a member (${market.country})`, async ({ store }) => {
      await store.openProduct(MEMBERSHIP_PRODUCT, market);

      await expect(store.pdpPrice).toHaveText(PRICE_WITH_AMOUNT);
      await expect(store.pdpPrice).not.toHaveText(TEXT.free);
      await expect(store.memberPriceNote, 'no "Member price" block on the membership itself').toHaveCount(0);
    });
  }

  test('MEM-008 an active member can buy the membership again', async ({ store }) => {
    // Expected behaviour (confirmed 2026-10-19): a member may purchase the subscription again.
    await store.clearCart();
    await store.openProduct(MEMBERSHIP_PRODUCT, 'GB');

    await expect(store.pdpAddButton).toBeEnabled();
    await store.pdpAddButton.click();

    await expect
      .poll(async () => (await store.cart()).items.map((i) => i.handle))
      .toContain(MEMBERSHIP_PRODUCT);
    // afterEach empties the cart again — nothing goes to checkout
  });

  // ---------------- Members area ----------------

  test.describe('Members area', () => {
    test.beforeEach(async ({ store }) => {
      await store.open(MEMBERS_AREA, 'GB');
    });

    test('ACC-001 greeting and profile heading', async ({ page }) => {
      await expect(page.locator('h1.main_heading')).toHaveText(/^Hello .*!$/);
      await expect(page.locator('.account-actions__main-menu h1')).toBeVisible();
    });

    test('ACC-002 profile shows the member e-mail', async ({ page }) => {
      test.skip(!MEMBER_EMAIL, 'Set MEMBER_EMAIL in .env');
      const profile = page.locator('.custom_account_actions .account-actions__header');
      await expect(profile.locator('#account-drawer-heading')).toBeVisible();
      await expect(profile.locator('.account-actions__email')).toContainText(MEMBER_EMAIL, { ignoreCase: true });
    });

    test('ACC-003 "Member since" shows a date', async ({ page }) => {
      const since = page.locator('.member_since');
      test.skip((await since.count()) === 0, 'Member has no orders — "Member since" is not rendered (ACC-004)');
      await expect(since).toHaveText(/[A-Z][a-z]+ \d{2}, \d{4}/);
    });

    test('ACC-005/006 Subscription and Settings links', async ({ page }) => {
      const nav = page.locator('.custom_account_actions .account-actions__nav');
      await expect(nav.locator('a[href*="shopify.com/"][href*="/account/pages/"]')).toHaveCount(1);
      await expect(nav.locator('a[href="/account"]')).toHaveCount(1);
    });

    test('ACC-007 membership block counts the available workbooks', async ({ page }) => {
      const block = page.locator('.your_membership');
      await expect(block).toBeVisible();
      await expect(block.locator('img')).toHaveJSProperty('complete', true);
      // The count is filled in by an inline script ~after DOMContentLoaded.
      await expect(block.locator('.workbooks span')).not.toHaveText('0', { timeout: 10_000 });
    });

    test('ACC-008 support block with the support e-mail', async ({ page }) => {
      await expect(page.locator('.support_block')).toBeVisible();
      await expect(page.locator('.support_block a[href^="mailto:"]')).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
    });
  });

  for (const market of ['DE', 'SE'] as const) {
    test(`TRN-005 members area greeting and labels are translated (${market})`, async ({ page, store }) => {
      // Known: "Hello" and "Workbooks" are hard-coded English in users-section.liquid — expected to fail until translated.
      test.info().annotations.push({ type: 'known-risk', description: 'R-12' });
      await store.open(MEMBERS_AREA, market);
      await expect(page.locator('h1.main_heading')).not.toHaveText(/^Hello\b/);
      await expect(page.locator('.your_membership .workbooks')).not.toContainText('Workbooks');
    });
  }

  for (const width of [375, 768, 1440]) {
    test(`ACC-019 members area has no horizontal scroll at ${width}px`, async ({ page, store }) => {
      await page.setViewportSize({ width, height: 900 });
      await store.open(MEMBERS_AREA, 'GB');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'horizontal overflow, px').toBeLessThanOrEqual(1);
      await expect(page.locator('.account-actions__main-menu')).toBeVisible();
    });
  }

  test('ACC-018 header account menu shows the member and an Orders link', async ({ page, store }) => {
    await store.open('/', 'GB');
    await page.locator('.account-button').first().click();

    const panel = page.locator('.account-actions').filter({ has: page.locator('.user_action') }).first();
    await expect(panel).toBeVisible();
    if (MEMBER_EMAIL) await expect(panel.locator('.account-actions__email')).toContainText(MEMBER_EMAIL, { ignoreCase: true });
    await expect(panel.locator('a.account-actions__link[href*="/account"]').first()).toBeVisible();
    await expect(panel.locator('#customer_logout_link, a[href*="logout"]').first()).toBeVisible();
  });
});
