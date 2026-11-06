import { test, expect } from './fixtures';
import { parseMoney } from './money';
import { CURRENCY_SYMBOL, GROUPS, MEMBERSHIP_PRODUCT, type Market } from '../test-data/store';

/**
 * Product page (PDP) checks shared by tests/pages/pdp*.spec.ts — one suite per market.
 * Product under test: the "october2025" language group (GB/US: october-2025, DE: zuruck-zur-erde, SE: att-vila-i-jorden).
 * Live markup (2026-10-21):
 *  - gallery: media-gallery › slideshow-slide (click opens zoom-dialog › dialog, × = .dialog-zoomed-gallery__close-button).
 *    Every product has 1 image today — no thumbnails or arrows to test.
 *  - accordions: accordion-custom › details[data-testid="accordion-details"] (description, "What to expect", FAQ);
 *    the 3rd one (first FAQ) is open by default
 *  - meta line: .product_meta_info .meta_item (pages-count.svg icon + "28 Pages" / "29 Seiten" / "27 Sidor")
 *  - language: select[data-pdp-language-select] (en/sv/de) + hidden properties[_language] and properties[_market]
 *  - recommendations: product-recommendations (loaded from /recommendations/products), 3 products
 *  - membership: variant-picker radios (Monthly/Yearly, translated), price per market from /products/daosense-membership.js
 * No rating block, no quantity selector on the PDP (confirmed by the team) — not tested.
 * `@smoke` = critical path, run after a deploy: npm run test:smoke
 */

/** Critical-path tests, run after every deploy (`npm run test:smoke`). */
export const SMOKE = { tag: '@smoke' };

const DESCRIPTION = 'main details[data-testid="accordion-details"]';

/** Registers the product page suite for one market. */
export function pdpPageSuite(market: Market) {
  const handle = GROUPS.october2025[market.language];
  const prefix = market.prefix;
  const productPath = `${prefix}/products/${handle}`;

  test.describe(`Product page — ${market.country} / ${market.language}`, () => {
    test(`PDP-001 ${productPath} opens with title, gallery, description, language selector, add to cart and recommendations`, SMOKE, async ({ page, store }) => {
      await store.openProduct(handle, market); // also checks link + header + Shopify state
      const { data } = await store.api('GET', `products/${handle}.js`);

      expect(await page.locator('html').getAttribute('lang')).toBe(market.language);
      await expect(page.locator('main h1').first(), 'H1 = product title in this language').toHaveText(data.title.trim());
      await expect(page.locator('media-gallery img').first()).toBeVisible();
      await expect(page.locator(DESCRIPTION).first()).toBeAttached();
      await expect(store.pdpLanguageSelect).toBeVisible();
      await expect(store.pdpAddButton).toBeEnabled();
      await expect(page.locator('product-recommendations')).toBeAttached();
      expect(await page.content()).not.toMatch(/translation missing/i);
    });

    test(`PDP-002 price is shown in ${market.currency} and equals the product price of this market`, SMOKE, async ({ store }) => {
      await store.openProduct(handle, market);
      await expect(store.pdpPrice, `price in ${market.currency}`).toHaveText(CURRENCY_SYMBOL[market.currency]);
      expect(parseMoney(await store.pdpPrice.innerText()), 'amount = price of this market').toBe(await store.productPrice(handle));
      expect((await store.cart()).currency, 'cart currency of the visitor').toBe(market.currency);
    });

    // images must load here — turn the asset blocking off for this test only
    test.describe(() => {
      test.use({ loadAssets: true });

      test('PDP-003 gallery shows every product image; zoom opens and closes with × and Esc', async ({ page, store }) => {
        // The automatic newsletter popup (Shopify Forms) can open on top of the zoom dialog; the zoom then covers its × and
        // the fixture cannot close it. The popup itself is covered by pages/homepage.spec.ts — keep it out of this test.
        await page.route('**/forms.shopifyapps.com/**', (route) => route.abort());
        await store.openProduct(handle, market);
        const { data } = await store.api('GET', `products/${handle}.js`);
        const slides = page.locator('media-gallery slideshow-slide');
        await expect(slides, 'one slide per product image').toHaveCount(data.media.length);

        const img = slides.first().locator('img');
        await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), { message: 'main image loads' }).toBe(true);

        const zoom = page.locator('media-gallery zoom-dialog dialog');
        await slides.first().click();
        await expect(zoom, 'click on the image opens the zoom').toBeVisible();
        await expect(zoom.locator('img').first()).toBeVisible();
        await zoom.locator('.dialog-zoomed-gallery__close-button').click();
        await expect(zoom, '× closes the zoom').toBeHidden();

        await slides.first().click();
        await expect(zoom).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(zoom, 'Esc closes the zoom').toBeHidden();
      });
    });

    test('PDP-004 description and the "pages / exercises" line are filled in', async ({ page, store }) => {
      await store.openProduct(handle, market);
      const description = page.locator(DESCRIPTION).first();
      await expect(description.locator(':scope > :not(summary)').first(), 'description has text').toHaveText(/\w{3,}/);

      const items = page.locator('main .product_meta_info .meta_item');
      expect(await items.count(), 'meta line items').toBeGreaterThan(0);
      for (const item of await items.all()) await expect(item.locator('span'), 'no empty label').toHaveText(/\S/);
      await expect(items.filter({ has: page.locator('img[src*="pages-count"]') }).locator('span'), 'page count').toHaveText(/\d+/);
    });

    test('PDP-005 every accordion (description, FAQ) opens and closes with the keyboard and the mouse', async ({ page, store }) => {
      await store.openProduct(handle, market);
      const items = page.locator(DESCRIPTION);
      const count = await items.count();
      expect(count, 'accordions on the PDP').toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const summary = item.locator('summary');
        const keyboard = async () => {
          await summary.focus();
          await page.keyboard.press('Enter');
        };
        // near the label's start: the theme's <accordion-custom> wrapper can swallow clicks at the centre (seen on the home FAQ)
        const mouse = () => summary.click({ position: { x: 8, y: 8 } });

        if ((await item.getAttribute('open')) !== null) {
          await keyboard(); // close the one that is open by default
          await expect(item).not.toHaveAttribute('open', '');
        }
        await keyboard();
        await expect(item, `accordion ${i + 1} opens with Enter`).toHaveAttribute('open', '');
        await expect(item.locator(':scope > :not(summary)').first(), `accordion ${i + 1} shows its content`).toBeVisible();
        await keyboard();
        await expect(item, `accordion ${i + 1} closes with Enter`).not.toHaveAttribute('open', '');

        await mouse();
        await expect(item, `accordion ${i + 1} opens with a click`).toHaveAttribute('open', '');
        await mouse();
        await expect(item, `accordion ${i + 1} closes with a click`).not.toHaveAttribute('open', '');
      }
    });

    test(`PDP-006 "You may also like" shows other products of this market with ${market.currency} prices and working links`, async ({ page, store }) => {
      await store.openProduct(handle, market);
      const recs = page.locator('product-recommendations');
      await recs.scrollIntoViewIfNeeded(); // loaded on scroll from /recommendations/products
      await expect(recs.locator('product-card').first(), 'recommendations load').toBeVisible();

      const paths = [...new Set(await recs.locator('a[href*="/products/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname)))];
      expect(paths.length, 'recommended products').toBeGreaterThan(0);
      expect(paths, 'the product is not recommended to itself').not.toContain(productPath);
      const wrongPrefix = paths.filter((p) => (prefix ? !p.startsWith(`${prefix}/products/`) : !/^\/products\//.test(p)));
      expect(wrongPrefix, `links without the ${prefix || 'English'} prefix`).toEqual([]);

      const broken: string[] = [];
      for (const path of paths) {
        const { status } = await store.api('GET', `products/${path.split('/products/')[1]}.js`);
        if (status !== 200) broken.push(`${path} → ${status}`);
      }
      expect(broken, `recommended products that do not open in ${market.country}`).toEqual([]);

      for (const price of await recs.locator('product-price .price').all()) {
        await expect(price, `price in ${market.currency}`).toHaveText(CURRENCY_SYMBOL[market.currency]);
      }
    });

    test(`PDP-007 language selector preselects "${market.language}"; hidden _language / _market match the market`, async ({ page, store }) => {
      await store.openProduct(handle, market);
      await expect(store.pdpLanguageSelect).toHaveValue(market.language);
      const options = await store.pdpLanguageSelect.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      expect([...options].sort(), 'English, Svenska, Deutsch are offered').toEqual(['de', 'en', 'sv']);
      await expect(store.pdpLanguageInput).toHaveValue(market.language);
      await expect(page.locator('[data-pdp-market-input]')).toHaveValue(market.country);
    });

    test('PDP-008 "Add to cart" adds the product with _language / _market, opens the cart drawer and shows 1 in the header', SMOKE, async ({ page, store }) => {
      await store.open('/', market);
      await store.clearCart();
      await store.openProduct(handle, market);

      await store.pdpAddButton.click();
      await expect.poll(async () => (await store.cart()).items.map((i) => [i.handle, i.quantity])).toEqual([[handle, 1]]);
      const [line] = (await store.cart()).items;
      expect(line.properties?._language, 'line property _language').toBe(market.language);
      expect(line.properties?._market, 'line property _market').toBe(market.country);
      await expect(store.cartDrawer).toBeVisible();
      await expect(store.cartBubbleCount).toHaveText('1');
      expect(new URL(page.url()).pathname, 'no language redirect — same PDP').toBe(productPath);
    });

    test('PDP-009 adding the same product twice gives one line with quantity 2; the header shows 2, also after a reload', async ({ page, store }) => {
      await store.open('/', market);
      await store.clearCart();
      await store.openProduct(handle, market);
      await store.pdpAddButton.click();
      await expect.poll(async () => (await store.cart()).item_count).toBe(1);

      await store.openProduct(handle, market); // back on the same PDP, same language
      await store.pdpAddButton.click();
      await expect.poll(async () => (await store.cart()).items.map((i) => [i.handle, i.quantity]), 'one line, quantity 2').toEqual([[handle, 2]]);
      await expect(store.cartBubbleCount).toHaveText('2');

      await page.reload();
      await expect(store.cartBubbleCount, 'count kept after reload').toHaveText('2');
    });

    test('PDP-010 rapid repeated "Add to cart" clicks do not create duplicate lines', async ({ page, store }) => {
      await store.open('/', market);
      await store.clearCart();
      await store.openProduct(handle, market);
      await store.pdpAddButton.scrollIntoViewIfNeeded();
      const box = await store.pdpAddButton.boundingBox();
      expect(box, 'add-to-cart button is on screen').not.toBeNull();

      // 5 clicks as fast as a shopper can — no waiting in between (later ones may land on the opening drawer)
      for (let i = 0; i < 5; i++) await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await expect
        .poll(
          async () => {
            const cart = await store.cart();
            const bubble = ((await store.cartBubbleCount.textContent()) || '').trim();
            return { lines: cart.items.length, handles: cart.items.map((i) => i.handle), bubbleMatches: bubble === String(cart.item_count) };
          },
          { message: 'one line for the product and the header count = cart quantity' }
        )
        .toEqual({ lines: 1, handles: [handle], bubbleMatches: true });
    });

    test('PDP-011 "Buy now membership…" opens the membership page in the same market', async ({ page, store }) => {
      await store.openProduct(handle, market);
      const link = store.memberPriceNote.locator(`a[href*="/products/${MEMBERSHIP_PRODUCT}"]`);
      // /de, /sv: the link drops the language prefix — finding F-13
      await expect(link, `link keeps the ${prefix || 'English'} prefix (F-13)`).toHaveAttribute('href', `${prefix}/products/${MEMBERSHIP_PRODUCT}`);
      await link.click();
      await page.waitForURL((u) => u.pathname.endsWith(`/products/${MEMBERSHIP_PRODUCT}`));
      await store.expectMarket(market);
      await expect(page.locator('variant-picker'), 'membership plans are shown').toBeVisible();
    });

    test('PDP-012 accelerated checkout buttons are rendered (not clicked)', async ({ page, store }) => {
      await store.openProduct(handle, market);
      await expect(page.locator('main shopify-accelerated-checkout').first()).toBeAttached();
    });

    test(`PDP-013 membership: each plan shows its own ${market.currency} price; the chosen plan is added with its subscription`, SMOKE, async ({ page, store }) => {
      await store.open('/', market);
      await store.clearCart();
      await store.openProduct(MEMBERSHIP_PRODUCT, market);
      const { data } = await store.api('GET', `products/${MEMBERSHIP_PRODUCT}.js`);

      // plan names are translated (Monthly / Monatlich / Månatlig) — read them, match them to the variants of this market
      const plans = page.locator('variant-picker input[type="radio"]');
      await expect(plans, 'one plan per variant').toHaveCount(data.variants.length);
      let chosen = 0;
      for (const plan of await plans.all()) {
        const name = await plan.getAttribute('value');
        const variant = data.variants.find((v: any) => v.title === name);
        expect(variant, `variant for plan "${name}"`).toBeTruthy();
        // the transparent radio (aria-label = plan name) covers the whole plan pill — it is what a shopper's click hits
        const radio = page.locator('variant-picker').getByRole('radio', { name: name as string, exact: true });
        await radio.check();
        await expect(radio, `plan "${name}" is selected`).toBeChecked();
        await expect(store.pdpPrice, `"${name}" price in ${market.currency}`).toHaveText(CURRENCY_SYMBOL[market.currency]);
        await expect.poll(async () => parseMoney(await store.pdpPrice.innerText()), `"${name}" price`).toBe(variant.price);
        chosen = variant.id;
      }
      await expect(page.locator('.shopify_subscriptions_app_policy').first(), 'subscription terms are shown').toHaveText(/\S/);

      await store.pdpAddButton.click();
      await expect
        .poll(async () => (await store.cart()).items.map((i: any) => [i.handle, i.variant_id, Boolean(i.selling_plan_allocation)]), 'the last chosen plan, as a subscription')
        .toEqual([[MEMBERSHIP_PRODUCT, chosen, true]]);
    });
  });
}
