import { test, expect } from '../../helpers/fixtures';
import type { Page } from '@playwright/test';
import { parseMoney } from '../../helpers/money';
import { CURRENCY_SYMBOL, GROUPS, MARKETS, type Country, type Language } from '../../test-data/store';

/**
 * MKT-023…025, 033 — the cart while it is re-synced to a new market, and the prices it shows afterwards
 * (assets/cart-market-lock.js + cart-market-validation.js — DAO-42).
 */

const SWAP_DELAY_MS = 4_000;

/** Slows down the product lookup used by the swap so the lock window is long enough to observe. */
async function slowDownSwap(page: Page) {
  await page.route(/\/products\/[^/?]+\.js(\?|$)/, async (route) => {
    await new Promise((r) => setTimeout(r, SWAP_DELAY_MS));
    await route.continue();
  });
}

test.describe('Cart lock during market switch', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.waitForCartSync();
    await store.addProduct(GROUPS.foundations.en, 1);
  });

  test('MKT-023 checkout, remove and quantity controls are locked until the re-sync finishes', async ({ page, store }) => {
    await slowDownSwap(page);
    await store.setMarket('DE');
    await store.gotoPolitely(store.url('/cart', 'DE'), { waitUntil: 'domcontentloaded' });
    await store.expectMarket('DE');

    // --- while the cart is being processed ---
    await expect(store.lockedRoot).toHaveCount(1);
    await expect(page.locator('body')).toHaveAttribute('aria-busy', 'true');
    await expect(store.checkoutButton, 'Checkout is disabled while syncing').toBeDisabled();

    await expect(store.cartRemoveButtons.first(), 'cart should show the line with its remove button').toBeAttached();
    for (const remove of await store.cartRemoveButtons.all()) {
      await expect(remove, 'Remove is disabled while syncing').toBeDisabled();
    }

    const stepper = await store.cartStepperControls.all();
    if (stepper.length === 0) {
      test.info().annotations.push({ type: 'note', description: 'No quantity stepper in the cart (quantity-selector is commented out in snippets/cart-products.liquid)' });
    }
    for (const control of stepper) {
      await expect(control, 'quantity stepper is disabled while syncing').toBeDisabled();
    }

    // Trying anyway must not change the cart: a forced click on Remove is swallowed by the disabled button.
    await store.cartRemoveButtons.first().click({ force: true, timeout: 2_000 }).catch(() => {});

    // --- after the sync ---
    await store.waitForCartSync();

    await expect(store.lockedRoot).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('aria-busy', 'true');
    await expect(store.checkoutButton).toBeEnabled();
    for (const remove of await store.cartRemoveButtons.all()) await expect(remove).toBeEnabled();

    const cart = await store.cart();
    expect(cart.item_count, 'the click on Remove during the lock must not have removed the item').toBe(1);
    expect(cart.items.map((i) => i.handle)).toEqual([GROUPS.foundations.de]);
  });

  test('MKT-024 failsafe releases a stuck lock after ~12 s', async ({ page, store }) => {
    test.setTimeout(60_000);
    await store.open('/cart', 'GB');
    await store.waitForCartSync();

    await page.evaluate(() => (window as any).lockCartForMarketSwitch());
    await expect(store.lockedRoot).toHaveCount(1);
    await expect(store.checkoutButton).toBeDisabled();

    await expect(store.lockedRoot).toHaveCount(0, { timeout: 15_000 });
    await expect(store.checkoutButton).toBeEnabled();
  });

  test('MKT-025 cannot reach checkout with stale lines while the cart is re-syncing', async ({ page, store }) => {
    await slowDownSwap(page);

    // Only real page navigations count. The cart page itself preloads checkout scripts
    // (/checkouts/internal/preloads.js, checkout-web assets) — that is not "going to checkout".
    const checkoutNavigations: string[] = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame() && /\/checkouts?(\/|$)/.test(new URL(r.url()).pathname)) {
        checkoutNavigations.push(r.url());
      }
    });

    await store.setMarket('DE');
    await store.gotoPolitely(store.url('/cart', 'DE'), { waitUntil: 'domcontentloaded' });
    await store.expectMarket('DE');
    await expect(store.lockedRoot).toHaveCount(1);

    for (let i = 0; i < 5; i++) {
      await store.checkoutButton.click({ force: true, noWaitAfter: true, timeout: 1_000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await store.waitForCartSync();

    expect(checkoutNavigations, 'no navigation to checkout while the cart was locked').toEqual([]);
    expect(new URL(page.url()).pathname, 'shopper is still on the cart page').toBe('/de/cart');
    expect((await store.cart()).items.map((i) => i.handle)).toEqual([GROUPS.foundations.de]);
  });
});

/**
 * MKT-033 — after a market switch the cart shows the new market's prices and currency.
 * Expected line price = product price in the NEW market × quantity (from /products/<handle>.js there).
 */
test.describe('Cart prices after market switch', () => {
  const QUANTITY = 2;
  const switches: Array<{ to: Country; language: Language }> = [
    { to: 'DE', language: 'de' },
    { to: 'SE', language: 'sv' },
    { to: 'US', language: 'en' }, // same product (foundations), only the currency changes
  ];

  for (const { to, language } of switches) {
    test(`MKT-033 GB → ${to}: cart shows ${MARKETS[to].currency} prices of the ${to} product`, async ({ store }) => {
      const market = MARKETS[to];
      const expectedHandle = GROUPS.foundations[language];

      await store.open('/', 'GB');
      await store.clearCart();
      await store.waitForCartSync();
      await store.addProduct(GROUPS.foundations.en, QUANTITY);

      await store.open('/cart', market); // checks link + header = new market
      await store.waitForCartSync();

      // price the shopper should pay in the new market
      const unitPrice = await store.productPrice(expectedHandle);
      const expectedLine = unitPrice * QUANTITY;

      // cart data
      const cart = await store.cart();
      expect(cart.currency, 'cart currency').toBe(market.currency);
      expect(cart.items.map((i) => [i.handle, i.quantity])).toEqual([[expectedHandle, QUANTITY]]);
      expect(cart.items[0].final_line_price, 'line price in cart.js').toBe(expectedLine);

      // what the shopper sees
      await expect(store.cartLinePrices).toHaveCount(1);
      const lineText = await store.cartLinePrices.first().innerText();
      expect(lineText, `line price is shown in ${market.currency}`).toMatch(CURRENCY_SYMBOL[market.currency]);
      expect(parseMoney(lineText), 'line price on the page').toBe(expectedLine);

      const totalText = await store.cartTotal.innerText();
      expect(totalText, `total is shown in ${market.currency}`).toMatch(CURRENCY_SYMBOL[market.currency]);
      expect(parseMoney(totalText), 'cart total on the page').toBe(expectedLine);
    });
  }
});
