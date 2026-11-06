import { test as base, expect } from '@playwright/test';
import { Storefront } from './storefront';

interface Options {
  /** Pretend the visitor already picked a region, so the first-visit market popup stays hidden. */
  marketPopupSeen: boolean;
  /**
   * Close the automatic "Subscribe to the DaoSense newsletter" dialog (Shopify Forms, <shopify-forms-embed>)
   * with its "Close modal" button whenever it shows up — like a shopper would. Off for tests of the popup itself.
   */
  closeNewsletterPopup: boolean;
  /**
   * Load the page like a real browser: images, video, fonts and analytics/tracking.
   * Off by default — the live store rate-limits per IP (HTTP 429 / Cloudflare bot check) and ~90% of a page's
   * requests to www.daosense.org are images under /cdn/shop and analytics pixels that the checks never look at.
   * Turn it on with `test.use({ loadAssets: true })` for tests that check images, layout, contrast or the console.
   */
  loadAssets: boolean;
}

interface Fixtures {
  store: Storefront;
  /** Uncaught page errors + console.error messages collected during the test. */
  consoleErrors: string[];
}

/** Resource types the checks do not need (blocked unless `loadAssets` is on). */
const HEAVY_RESOURCES = new Set(['image', 'media', 'font']);
/** Analytics / tracking calls: Shopify web pixels + monorail, Klaviyo, Pinterest, Google, Meta. */
const TRACKING =
  /\/web-pixels[@/]|\/\.well-known\/shopify\/monorail|\/api\/collect|monorail-edge\.shopifysvc\.com|otlp-http-production\.shopifysvc\.com|klaviyo\.com|ct\.pinterest\.com|google-analytics\.com|googletagmanager\.com|merchant-center-analytics\.goog|facebook\.(com|net)/;

export const test = base.extend<Options & Fixtures>({
  marketPopupSeen: [true, { option: true }],
  closeNewsletterPopup: [true, { option: true }],
  loadAssets: [false, { option: true }],

  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    const storeHost = new URL(process.env.BASE_URL || 'https://www.daosense.org').host;
    // Only the store's own code counts; third-party pixels/apps (Pinterest, Google, Shop Pay…) are ignored.
    const isOwn = (url?: string) => !url || url.startsWith('about:') || new URL(url, `https://${storeHost}`).host === storeHost;
    page.on('pageerror', (e) => {
      const firstFrame = e.stack?.split('\n').find((l) => /https?:\/\//.test(l));
      const url = firstFrame?.match(/https?:\/\/[^\s)]+/)?.[0];
      if (isOwn(url)) errors.push(`pageerror: ${e.message}${url ? ` (${url})` : ''}`);
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location().url;
      if (/Failed to load resource/.test(m.text()) && !isOwn(url)) return;
      if (isOwn(url)) errors.push(`console.error: ${m.text()}${url ? ` (${url})` : ''}`);
    });
    await use(errors);
  },

  store: async ({ page, marketPopupSeen, closeNewsletterPopup, loadAssets }, use) => {
    if (!loadAssets) {
      // Registered first = lowest priority: a test's own page.route() still wins and decides for its URLs.
      await page.route('**/*', (route) => {
        const request = route.request();
        if (HEAVY_RESOURCES.has(request.resourceType()) || TRACKING.test(request.url())) return route.abort('blockedbyclient');
        return route.fallback();
      });
    }
    if (closeNewsletterPopup) {
      const newsletterDialog = page.locator('shopify-forms-embed').getByRole('dialog').first();
      await page.addLocatorHandler(newsletterDialog, async () => {
        await page
          .locator('shopify-forms-embed')
          .getByRole('button', { name: /close|schließen|stäng/i })
          .first()
          .click();
      });
    }
    if (marketPopupSeen) {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('market_selected', 'true');
        } catch {
          /* storage may be unavailable on about:blank */
        }
      });
    }
    await use(new Storefront(page));

    // Pause between tests: the live store rate-limits bursts (HTTP 429). TEST_PAUSE_MS=0 turns it off.
    const pause = Number(process.env.TEST_PAUSE_MS ?? 3000);
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
  },
});

export { expect };
