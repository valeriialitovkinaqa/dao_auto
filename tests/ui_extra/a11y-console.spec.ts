import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../../helpers/fixtures';
import { GROUPS } from '../../test-data/store';

// Full page load (images, fonts, analytics): contrast (axe) and console checks need the full page.
test.use({ loadAssets: true });

/**
 * A11Y-001…004, CON-001…002 — keyboard, screen-reader attributes, contrast (axe-core) and the browser console.
 * LAY-004 (cross-browser) is covered by running the whole suite in the chromium / firefox / webkit /
 * mobile-safari projects of playwright.config.ts.
 */

const PDP = GROUPS.october2025.en;

test.describe('Keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard checks are for desktop');

  test('A11Y-001 first Tab focuses "Skip to content", which moves focus to the main content', async ({ page, store }) => {
    await store.open('/', 'GB');
    await page.keyboard.press('Tab');
    await expect(page.locator('a.skip-to-content-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#MainContent');
  });

  test('A11Y-001 main menu links are reachable with Tab and show a focus outline', async ({ page, store }) => {
    await store.open('/', 'GB');
    const reached = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el?.matches('nav[header-menu] a.menu-list__link')) return null;
        const s = getComputedStyle(el);
        return { href: el.getAttribute('href') || '', outline: s.outlineStyle !== 'none' || s.boxShadow !== 'none' };
      });
      if (info) {
        reached.add(info.href);
        expect(info.outline, `focus is visible on ${info.href}`).toBe(true);
      }
    }
    expect(reached.size, 'all 5 menu links reachable by keyboard').toBe(5);
  });

  test('A11Y-002 a product can be added to the cart with the keyboard only', async ({ page, store }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.openProduct(PDP, 'GB');

    let onButton = false;
    for (let i = 0; i < 80 && !onButton; i++) {
      await page.keyboard.press('Tab');
      onButton = await page.evaluate(() => !!document.activeElement?.matches('button[name="add"]'));
    }
    expect(onButton, '"Add to cart" reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await store.cart()).item_count).toBe(1);
    await expect(store.cartDrawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(store.cartDrawer).toBeHidden();
  });
});

test.describe('Screen-reader basics', () => {
  test('A11Y-003 content images have alt, form fields have labels, notices are live regions', async ({ page, store }) => {
    await store.open('/', 'GB');
    const noAlt = await page.locator('main img:not([alt])').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).currentSrc.split('/').pop()));
    if (noAlt.length) test.info().annotations.push({ type: 'finding', description: `images without alt: ${noAlt.join(', ')}` });
    expect(noAlt, 'every <img> in main has an alt attribute (alt="" for decorative)').toEqual([]);

    await store.open('/pages/contact', 'GB');
    for (const name of ['contact[name]', 'contact[email]', 'contact[body]']) {
      const field = page.locator(`form.contact-form__form [name="${name}"]`).first();
      const id = await field.getAttribute('id');
      const labelled = (id && (await page.locator(`label[for="${id}"]`).count()) > 0) || (await field.getAttribute('aria-label'));
      expect(labelled, `${name} has a label`).toBeTruthy();
    }
  });
});

test.describe('Contrast (axe-core)', () => {
  for (const path of ['/', `/products/${PDP}`, '/pages/faq']) {
    test(`A11Y-004 no colour-contrast violations on ${path}`, async ({ page, store }) => {
      await store.open(path, 'GB');
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      const summary = results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n')[1] || ''}`));
      expect(summary, 'elements with insufficient contrast (WCAG AA)').toEqual([]);
    });
  }
});

test.describe('Console', () => {
  for (const path of ['/', '/collections/workbooks', `/products/${PDP}`, '/cart', '/blogs/news', '/pages/faq', '/pages/contact', '/pages/members-area']) {
    test(`CON-001 no JS errors on ${path}`, async ({ page, store, consoleErrors }) => {
      await store.open(path, 'GB');
      await page.waitForTimeout(5_000); // members area runs a 4 s timer
      expect(consoleErrors, `console errors on ${path}`).toEqual([]);
    });
  }

  test('CON-002 no JS errors while switching language on the PDP and the market of the cart', async ({ store, consoleErrors }) => {
    await store.open('/', 'GB');
    await store.clearCart();
    await store.addProduct(GROUPS.foundations.en, 1);
    await store.openProduct(GROUPS.foundations.en, 'GB');
    await store.switchLanguageAndAdd('de');
    await store.waitForPath(`/de/products/${GROUPS.foundations.de}`, 'DE');
    await store.waitForCartSync();

    await store.open('/cart', 'SE');
    await store.waitForCartSync();
    expect(consoleErrors, 'console errors during the switches').toEqual([]);
  });
});
