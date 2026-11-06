import { test, expect } from '../../helpers/fixtures';
import { parseMoney } from '../../helpers/money';
import { CURRENCY_SYMBOL, GROUPS, MARKETS, type Country } from '../../test-data/store';

/**
 * CART-001…006 — the cart and checkout.
 * Product page checks (former SMK-011, 013, 014, 015) moved to tests/pages/pdp*.spec.ts (PDP-001…013);
 * SMK-012 (PDP quantity field) dropped — the PDP has no quantity selector (confirmed by the team, 2026-10-21).
 * Live markup notes (2026-10-19): no stepper and no order note in the cart —
 * those cases are reported as skipped with the reason instead of failing.
 */

const PDP = GROUPS.october2025.en; // "Held by Earth"
const PDP2 = GROUPS.september.en;

test.describe('Cart', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.waitForCartSync();
  });

  test('CART-001 changing quantity in the cart recalculates totals', async ({ store }) => {
    await store.addProduct(PDP, 1);
    await store.open('/cart', 'GB');
    test.skip((await store.cartStepperControls.count()) === 0, 'No quantity stepper in the cart (quantity-selector is commented out in snippets/cart-products.liquid) — confirm with the team');
  });

  test('CART-002 removing items recalculates the total and ends in the empty state', async ({ page, store }) => {
    await store.addProduct(PDP, 1);
    await store.addProduct(PDP2, 1);
    await store.open('/cart', 'GB');
    await expect(store.cartRemoveButtons).toHaveCount(2);

    await store.cartRemoveButtons.first().click();
    await expect.poll(async () => (await store.cart()).item_count).toBe(1);
    const remaining = await store.cart();
    await expect.poll(async () => parseMoney(await store.cartTotal.innerText()), 'total = remaining line').toBe(remaining.items[0].final_line_price);
    await expect(store.cartBubbleCount).toHaveText('1');

    await store.cartRemoveButtons.first().click();
    await expect.poll(async () => (await store.cart()).item_count).toBe(0);
    await expect(page.locator('main a[href$="/collections/all"]').first(), 'empty cart offers "Continue shopping"').toBeVisible();
  });

  test('CART-003 an unknown discount code shows an error and keeps the total', async ({ page, store }) => {
    await store.addProduct(PDP, 1);
    await store.open('/cart', 'GB');
    const before = parseMoney(await store.cartTotal.innerText());

    await page.locator('input.cart-discount__input').fill('INVALID123');
    await page.locator('button.cart-discount__button').click();
    await expect(page.locator('.cart-discount__error').first()).toBeVisible();
    expect(parseMoney(await store.cartTotal.innerText())).toBe(before);

    const valid = process.env.PROMO_CODE;
    if (valid) {
      await page.locator('input.cart-discount__input').fill(valid);
      await page.locator('button.cart-discount__button').click();
      await expect.poll(async () => parseMoney(await store.cartTotal.innerText()), `${valid} lowers the total`).toBeLessThan(before);
    } else {
      test.info().annotations.push({ type: 'note', description: 'Valid code not checked — set PROMO_CODE in .env' });
    }
  });

  test('CART-004 order note is saved', async ({ page, store }) => {
    await store.addProduct(PDP, 1);
    await store.open('/cart', 'GB');
    test.skip((await page.locator('textarea[name="note"]').count()) === 0, 'No order note field in the live cart');
  });

  test('CART-005 cart drawer and /cart show the same lines and total', async ({ page, store }) => {
    await store.addProduct(PDP, 2);
    await store.open('/', 'GB');
    await store.cartDrawerTrigger.click();
    await expect(store.cartDrawer).toBeVisible();
    const drawerTitles = (await store.cartDrawer.locator('.cart-items__title').allInnerTexts()).map((t) => t.trim());
    const drawerTotal = parseMoney(await store.cartDrawer.locator('.cart__total-value').first().innerText());

    await store.open('/cart', 'GB');
    const pageTitles = (await page.locator('main .cart-items__title').allInnerTexts()).map((t) => t.trim());
    expect(pageTitles).toEqual(drawerTitles);
    expect(parseMoney(await store.cartTotal.innerText())).toBe(drawerTotal);
  });
});

test.describe('Checkout (opens it, never pays)', () => {
  test.skip(process.env.RUN_CHECKOUT !== 'true', 'Opens Shopify checkout on the store — set RUN_CHECKOUT=true to run');

  const MARKET_CHECKOUT: Array<{ country: Country; handle: string }> = [
    { country: 'GB', handle: GROUPS.october2025.en },
    { country: 'US', handle: GROUPS.october2025.en },
    { country: 'DE', handle: GROUPS.october2025.de },
    { country: 'SE', handle: GROUPS.october2025.sv },
  ];

  for (const { country, handle } of MARKET_CHECKOUT) {
    test(`CART-006 checkout opens in ${country} with the market currency`, async ({ page, store }) => {
      const market = MARKETS[country];
      await store.open('/', market);
      await store.clearCart();
      await store.addProduct(handle, 1);
      await store.open('/cart', market);
      await store.waitForCartSync();

      await page.locator('#checkout').click();
      await page.waitForURL(/\/checkouts\//, { timeout: 30_000 });
      await expect(page.locator('body')).toContainText(CURRENCY_SYMBOL[market.currency], { timeout: 20_000 });
      expect((await page.locator('html').getAttribute('lang'))?.toLowerCase().startsWith(market.language)).toBe(true);
      // stop here — no contact details, no payment
    });
  }
});
