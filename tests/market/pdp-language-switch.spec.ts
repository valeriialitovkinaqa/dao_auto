import { test, expect } from '../../helpers/fixtures';
import { GROUPS, MARKETS, TEXT, UNMAPPED_EN_PRODUCT } from '../../test-data/store';

/**
 * MKT-010…018 — PDP language selector + locale-aware add to cart
 * (blocks/buy-buttons.liquid, assets/product-form.js, assets/language-redirect.js — DAO-11 / DAO-40).
 */
test.describe('PDP language switch', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
  });

  test('MKT-010 en → de + ATC lands on the DE equivalent and adds it once', async ({ page, store }) => {
    const group = GROUPS.foundations;
    await store.openProduct(group.en, 'GB');

    await store.switchLanguageAndAdd('de');
    await store.waitForPath(`/de/products/${group.de}`, MARKETS.DE);

    await expect.poll(() => new URL(page.url()).searchParams.has('pdp_add'), { message: 'pdp_add is stripped' }).toBe(false);

    await expect.poll(async () => (await store.cart()).items.map((i) => [i.handle, i.quantity])).toEqual([[group.de, 1]]);
    const [item] = (await store.cart()).items;
    expect(item.properties?._language).toBe('de');
  });

  test('MKT-011 en → sv + ATC lands on the SE equivalent in SEK', async ({ store }) => {
    const group = GROUPS.foundations;
    await store.openProduct(group.en, 'GB');

    await store.switchLanguageAndAdd('sv');
    await store.waitForPath(`/sv/products/${group.sv}`, MARKETS.SE);

    await expect.poll(async () => (await store.cart()).items.map((i) => [i.handle, i.quantity])).toEqual([[group.sv, 1]]);
  });

  test('MKT-012 reloading after the switch does not add the product again', async ({ page, store }) => {
    const group = GROUPS.foundations;
    await store.openProduct(group.en, 'GB');
    await store.switchLanguageAndAdd('de');
    await store.waitForPath(`/de/products/${group.de}`, MARKETS.DE);
    await expect.poll(async () => (await store.cart()).item_count).toBe(1);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2_000); // give a (wrong) auto-submit the chance to fire

    expect((await store.cart()).item_count).toBe(1);
  });

  test('MKT-013/014 no equivalent → storefront root + one-off notice', async ({ page, store }) => {
    await store.openProduct(UNMAPPED_EN_PRODUCT, 'GB');

    await store.switchLanguageAndAdd('de');
    await store.waitForPath(/^\/de\/?$/, MARKETS.DE);

    await expect(store.notices.filter({ hasText: TEXT.langUnavailable.de })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has('lang_unavailable')).toBe(false);
    expect((await store.cart()).item_count, 'nothing is added on fallback').toBe(0);

    // MKT-014: notice disappears on its own and does not come back after reload
    await expect(store.notices).toHaveCount(0, { timeout: 10_000 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1_000);
    await expect(store.notices).toHaveCount(0);
  });

  test('MKT-015 US visitor keeps the US market when coming back to English', async ({ store }) => {
    test.fixme(true, 'Expected behaviour for US + en is not confirmed yet (code resolves en → GB, risk R-05)');

    const group = GROUPS.foundations;
    await store.openProduct(group.en, 'US');
    await store.switchLanguageAndAdd('de');
    await store.waitForPath(`/de/products/${group.de}`, MARKETS.DE);

    await store.switchLanguageAndAdd('en');
    await store.waitForPath(`/products/${group.en}`);
    await store.expectMarket(MARKETS.US);
  });

  test('MKT-016 changing the language without ATC only updates the hidden property', async ({ page, store }) => {
    await store.openProduct(GROUPS.foundations.en, 'GB');
    const urlBefore = page.url();

    await store.pdpLanguageSelect.selectOption('de');
    await page.waitForTimeout(1_000);

    expect(page.url()).toBe(urlBefore);
    await expect(store.pdpLanguageInput).toHaveValue('de');
    expect((await store.cart()).item_count).toBe(0);
  });

  test('MKT-017 preview_theme_id survives the language round-trip', async ({ page, store }) => {
    test.skip(!process.env.PREVIEW_THEME_ID, 'PREVIEW_THEME_ID is not set');

    await store.openProduct(GROUPS.foundations.en, 'GB');
    const localizationPost = page.waitForRequest((r) => r.method() === 'POST' && /\/localization/.test(r.url()));
    await store.switchLanguageAndAdd('de');

    const body = new URLSearchParams((await localizationPost).postData() || '');
    expect(body.get('return_to')).toContain(`preview_theme_id=${process.env.PREVIEW_THEME_ID}`);
    expect(body.get('country_code')).toBe('DE');
    expect(body.get('locale_code')).toBe('de');
  });

  test('MKT-018 going back after the switch leaves no lock behind', async ({ page, store }) => {
    const group = GROUPS.foundations;
    await store.openProduct(group.en, 'GB');
    await store.switchLanguageAndAdd('de');
    await store.waitForPath(`/de/products/${group.de}`, MARKETS.DE);

    await page.goBack({ waitUntil: 'load' });

    await expect(store.lockedRoot).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('aria-busy', 'true');
    await expect(store.pdpAddButton).toBeEnabled();
  });
});
