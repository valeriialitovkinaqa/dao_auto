import { test, expect } from '../../helpers/fixtures';
import { GROUPS, type Country } from '../../test-data/store';

// Full page load (images, fonts, analytics): layout checks need images and fonts.
test.use({ loadAssets: true });

/**
 * TRN-001…002, LAY-001…003 — translations (de / sv) and layout at 375 / 768 / 1024 / 1440 px.
 * Translation checks: no "translation missing", <html lang>, and the known UI labels are not English.
 */

const LOCALE_MARKETS: Array<{ country: Country; lang: 'de' | 'sv'; menu: string[]; cart: RegExp; search: RegExp }> = [
  { country: 'DE', lang: 'de', menu: ['Blog', 'Workbooks', 'Mitgliedschaft', 'FAQ', 'Kontakt'], cart: /Warenkorb/, search: /Suchen/ },
  { country: 'SE', lang: 'sv', menu: ['Blogg', 'Arbetsböcker', 'Medlemskap', 'Vanliga frågor', 'Kontakt'], cart: /Varukorg/, search: /Sökning/ },
];

const ENGLISH_ONLY = [/\bAdd to cart\b/, /\bCheck out\b/, /\bEstimated total\b/, /\bTotal items in cart\b/];

test.describe('Translations', () => {
  for (const { country, lang, menu, cart, search } of LOCALE_MARKETS) {
    test(`TRN-001 header, menu and home are in "${lang}"`, async ({ page, store, isMobile }) => {
      test.skip(!!isMobile, 'desktop header');
      await store.open('/', country);
      expect(await page.locator('html').getAttribute('lang')).toBe(lang);
      await expect(store.mainMenuLinks).toHaveText(menu);
      await expect(store.cartDrawerTrigger).toHaveAttribute('aria-label', cart);
      await expect(store.searchButton).toHaveAttribute('aria-label', search);
      expect(await page.content()).not.toMatch(/translation missing/i);
    });

    test(`TRN-001 footer links are translated (${lang})`, async ({ page, store }) => {
      // Found 2026-10-19: Contact / Return and refund policy / Shipping policy / Legal notice / Terms of Service stay English.
      test.info().annotations.push({ type: 'finding', description: 'Footer link texts not translated (see comparison report)' });
      await store.open('/', country);
      const footerTexts = (await page.locator('footer a').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      for (const english of ['Return and refund policy', 'Shipping policy', 'Legal notice', 'Terms of Service']) {
        expect(footerTexts, `"${english}" should be translated`).not.toContain(english);
      }
    });

    test(`TRN-002 PDP and cart labels are translated (${lang})`, async ({ page, store }) => {
      await store.open('/', country);
      await store.clearCart();
      await store.addProduct(GROUPS.october2025[lang], 1);
      for (const path of [`/products/${GROUPS.october2025[lang]}`, '/cart']) {
        await store.open(path, country);
        const text = await page.locator('main').innerText();
        for (const english of ENGLISH_ONLY) expect(text, `${path}: ${english}`).not.toMatch(english);
        expect(await page.content(), path).not.toMatch(/translation missing/i);
      }
    });
  }
});

const PAGES = ['/', '/collections/workbooks', `/products/${GROUPS.october2025.en}`, '/cart', '/pages/faq', '/blogs/news', '/pages/contact'];

test.describe('Layout — no horizontal scroll', () => {
  for (const [id, width] of [['LAY-001', 375], ['LAY-002', 768], ['LAY-002', 1024], ['LAY-003', 1440]] as const) {
    test(`${id} key pages fit ${width}px`, async ({ page, store }) => {
      await page.setViewportSize({ width, height: 900 });
      const overflowing: string[] = [];
      for (const path of PAGES) {
        await store.open(path, 'GB');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) overflowing.push(`${path} (+${overflow}px)`);
      }
      expect(overflowing, `pages wider than ${width}px`).toEqual([]);
    });
  }
});
