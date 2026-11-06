import { test, expect } from '../../helpers/fixtures';
import type { Page } from '@playwright/test';
import { MARKETS, SUPPORT_EMAIL, type Market } from '../../test-data/store';
import { RateLimitError, type Storefront } from '../../helpers/storefront';

// Full page load (images, fonts, analytics): this file checks images, carousels and the newsletter popup.
test.use({ loadAssets: true });

/**
 * Home page — https://www.daosense.org/ (en), /de, /sv.
 *  - opens in every market/language (link + header + <html lang>, H1, no failed requests)
 *  - product links lead to the right product (opens in the same market and language, no 404)
 *  - clickable elements are clickable (links resolve, buttons enabled, newsletter triggers open the popup)
 *  - "Your questions, answered" items open and close
 *  - carousels switch slides
 *  - no broken images
 *  - footer + contact form ("Let's connect", validated in the browser, never submitted)
 * Selectors from the live markup (2026-10-19).
 */

/**
 * Walks links and keeps the store's rate limit apart from real failures (BL-12).
 * `store.linkStatus` answers null when the limit outlived its waiting budget — that is "not checked",
 * never a broken link. Everything unchecked → RateLimitError (the run goes to the retry list);
 * some unchecked → the test still reports the real failures and says what it had to skip.
 */
async function checkLinks(
  store: Storefront,
  page: Page,
  paths: string[],
  isFailure: (status: number) => boolean,
  options: { maxRedirects?: number } = {}
): Promise<string[]> {
  const failed: string[] = [];
  const notChecked: string[] = [];
  for (const path of paths) {
    const status = await store.linkStatus(path, options);
    if (status === null) notChecked.push(path);
    else if (isFailure(status)) failed.push(`${path} → ${status}`);
    await page.waitForTimeout(1000);
  }
  if (paths.length && notChecked.length === paths.length) throw new RateLimitError(`link check (${paths.length} links)`);
  if (notChecked.length)
    test.info().annotations.push({
      type: 'rate limited',
      description: `not checked, the store kept answering 429: ${notChecked.join(', ')}`,
    });
  return failed;
}

const HOME_MARKETS: Market[] = [MARKETS.GB, MARKETS.US, MARKETS.DE, MARKETS.SE];

const FAQ_HEADING: Record<string, RegExp> = {
  en: /Your questions, answered/i,
  de: /Antworten auf häufige Fragen/i,
  sv: /Frågor och svar/i,
};

const POLICIES = [
  '/policies/privacy-policy',
  '/policies/subscription-policy',
  '/policies/refund-policy',
  '/policies/contact-information',
  '/policies/shipping-policy',
  '/policies/terms-of-service',
  '/policies/legal-notice',
];

/** Scrolls the whole page so lazy-loaded images and sections render. */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
}

/** Unique same-origin links inside `main` (no anchors, no mailto/tel), path + search. */
async function mainLinks(page: Page, selector = 'main a[href]'): Promise<string[]> {
  const hrefs = await page.locator(selector).evaluateAll((as) =>
    as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin) && !h.includes('#'))
  );
  return [...new Set(hrefs.map((h) => new URL(h).pathname + new URL(h).search))];
}

/** The "Your questions, answered" section (its accordion lives in the last FAQ section of main). */
const faqSection = (page: Page, lang: string) =>
  page.locator('main .shopify-section').filter({ has: page.getByRole('heading', { name: FAQ_HEADING[lang] }) }).last();

for (const market of HOME_MARKETS) {
  const home = market.prefix || '/';

  test.describe(`Home page — ${market.country} / ${market.language}`, () => {
    test.beforeEach(async ({ store }) => {
      await store.open('/', market); // also checks link + header market
    });

    test(`opens ${home} in ${market.language} with all sections`, async ({ page }) => {
      expect(await page.locator('html').getAttribute('lang')).toBe(market.language);
      await expect(page.locator('main h1').first()).toBeVisible();
      expect(await page.locator('main > .shopify-section, main .shopify-section').count(), 'sections rendered').toBeGreaterThan(5);
      await expect(page.getByRole('heading', { name: FAQ_HEADING[market.language] }).first()).toBeAttached();
      expect(await page.content()).not.toMatch(/translation missing/i);
    });

    test(`product links lead to products of the ${market.country} market`, async ({ page, store }) => {
      await scrollThrough(page);
      // the membership links are checked by "membership links … keep the language prefix" (finding F-01)
      const products = (await mainLinks(page, 'main a[href*="/products/"]')).map((p) => p.split('?')[0]).filter((p) => !p.endsWith('/products/daosense-membership'));
      const unique = [...new Set(products)];
      expect(unique.length, 'home shows product links').toBeGreaterThan(0);

      // every product link keeps the language prefix of the current storefront
      const wrongPrefix = unique.filter((p) => (market.prefix ? !p.startsWith(`${market.prefix}/`) : /^\/(de|sv)\//.test(p)));
      expect(wrongPrefix, `product links without the ${market.prefix || 'English'} prefix`).toEqual([]);

      // …and opens in this market (product of another market → 404)
      // waiting out the store's Retry-After: 60 does not fit the default 60 s test timeout
      test.slow();
      const broken = await checkLinks(store, page, unique, (status) => status !== 200);
      expect(broken, 'product links that do not open in this market').toEqual([]);

      // a card title matches the product page it opens
      // click the product title like a shopper (a.product-card__link lies underneath the card content)
      const card = page.locator('main product-card').filter({ visible: true }).first();
      const titleLink = card.locator('a[ref="productTitleLink"]').first();
      const title = (await titleLink.innerText()).trim();
      // the link itself is `display: contents` (no box to click) — click its visible title text
      await titleLink.getByText(title).first().click();
      await page.waitForURL(/\/products\//);
      await store.expectMarket(market);
      await expect(page.locator('main h1')).toHaveText(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    });

    test('"Your questions, answered" items open and close', async ({ page }) => {
      const section = faqSection(page, market.language);
      await section.scrollIntoViewIfNeeded();
      const items = section.locator('details');
      const count = await items.count();
      expect(count, 'FAQ items').toBeGreaterThan(0);

      // toggled with the keyboard (focus + Enter): the theme's <accordion-custom> wrapper sits over the summary
      // and swallows pointer clicks at its centre — the keyboard path is what a shopper's click triggers too.
      const toggle = async (summary: ReturnType<typeof items.first>) => {
        await summary.focus();
        await page.keyboard.press('Enter');
      };
      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const summary = item.locator('summary');
        if ((await item.getAttribute('open')) !== null) {
          await toggle(summary); // close the one that is open by default
          await expect(item).not.toHaveAttribute('open', '');
        }
        await toggle(summary);
        await expect(item, `FAQ item ${i + 1} opens`).toHaveAttribute('open', '');
        await expect(item.locator(':scope > :not(summary)').first(), `FAQ item ${i + 1} shows its answer`).toBeVisible();
        await toggle(summary);
        await expect(item, `FAQ item ${i + 1} closes`).not.toHaveAttribute('open', '');
      }
    });

    test('no broken images', async ({ page }) => {
      await scrollThrough(page);
      await page.waitForLoadState('networkidle').catch(() => {});
      const broken = await page.locator('img').evaluateAll((imgs) =>
        imgs
          .map((i) => i as HTMLImageElement)
          .filter((i) => i.complete && !!i.currentSrc && i.naturalWidth === 0)
          .map((i) => i.currentSrc.split('?')[0])
      );
      expect([...new Set(broken)], 'images that failed to load').toEqual([]);
    });
  });
}

test.describe('Home page — interactions (GB / en)', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
  });

  test('clickable elements are clickable: links resolve, buttons are enabled', async ({ page, store }) => {
    test.slow(); // the link check may have to sit out the store's Retry-After: 60
    await scrollThrough(page);

    // links without a destination
    const dead = await page.locator('main a:visible').evaluateAll((as) =>
      as
        .map((a) => a as HTMLAnchorElement)
        .filter((a) => !a.getAttribute('href') && !a.getAttribute('role') && !a.onclick)
        .map((a) => a.outerHTML.slice(0, 120))
    );
    expect(dead, 'visible links without href').toEqual([]);

    // every internal link answers (no 404 / 5xx) — 429 is the store's limit, not a failure (BL-12)
    const failed = await checkLinks(store, page, await mainLinks(page), (status) => status >= 400, { maxRedirects: 5 });
    expect(failed, 'internal links that fail').toEqual([]);

    // visible buttons can be used (carousel arrows are disabled at the first/last slide by design)
    for (const button of await page.locator('main button:visible:not(.slideshow-control)').all()) {
      await expect(button).toBeEnabled();
    }
    for (const carousel of await page.locator('main slideshow-component:has(button.slideshow-control--next:visible)').all()) {
      const prev = carousel.locator('button.slideshow-control--previous').first();
      const next = carousel.locator('button.slideshow-control--next').first();
      expect((await prev.isEnabled()) || (await next.isEnabled()), 'a carousel has at least one active arrow').toBe(true);
    }

    // "#" links are the "SUBSCRIBE" triggers — checked in "automatic newsletter popup" below
  });

  test('main CTAs lead to the right pages', async ({ page }) => {
    const ctas: Array<{ name: RegExp; path: string }> = [
      { name: /become a member/i, path: '/products/daosense-membership' },
    ];
    for (const { name, path } of ctas) {
      await page.getByRole('link', { name }).first().click();
      await page.waitForURL((u) => u.pathname === path);
      await page.goBack();
    }
    await page.locator('main a[href="/collections/workbooks"]').first().click();
    await page.waitForURL((u) => u.pathname === '/collections/workbooks');
  });

  test('carousels switch slides with the arrows', async ({ page, isMobile }) => {
    await scrollThrough(page);
    const carousels = page.locator('main slideshow-component').filter({ has: page.locator('button.slideshow-control--next:visible') });
    const count = await carousels.count();
    test.skip(count === 0, isMobile ? 'no carousel with visible arrows' : 'no carousel with visible arrows on desktop');

    for (let i = 0; i < count; i++) {
      const carousel = carousels.nth(i);
      await carousel.scrollIntoViewIfNeeded();
      const slides = carousel.locator('slideshow-slides').first();
      const position = () => slides.evaluate((el) => Math.round(el.scrollLeft));
      const before = await position();

      await carousel.locator('button.slideshow-control--next').filter({ visible: true }).first().click();
      await expect.poll(position, `carousel ${i + 1}: "Next" moves the slides`).not.toBe(before);

      const afterNext = await position();
      await carousel.locator('button.slideshow-control--previous').filter({ visible: true }).first().click();
      await expect.poll(position, `carousel ${i + 1}: "Previous" moves back`).toBeLessThan(afterNext);
    }
  });

  test('membership links on the localized home keep the language prefix', async ({ page, store }) => {
    // Hero CTAs ("Werde Mitglied" / "Become a member") are correct (/de/…, /sv/…).
    // Found 2026-10-19 in the live HTML: the "Das Team" / "Meet the team" button in "The DaoSense approach"
    // is an absolute https://www.daosense.org/products/daosense-membership link, and the account menu
    // "Werde Mitglied" (snippets/account-actions.liquid) is hard-coded /products/daosense-membership.
    for (const market of [MARKETS.DE, MARKETS.SE]) {
      await store.open('/', market);
      const links = await page.locator('main a[href*="/products/daosense-membership"], #account-popover a[href*="/products/daosense-membership"]').evaluateAll((as) =>
        as.map((a) => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim(), path: new URL((a as HTMLAnchorElement).href).pathname }))
      );
      expect(links.length).toBeGreaterThan(0);
      const wrong = links.filter((l) => !l.path.startsWith(`${market.prefix}/`)).map((l) => `"${l.text}" → ${l.path}`);
      expect(wrong, `${market.country}: membership links that drop ${market.prefix}`).toEqual([]);
    }
  });
});

test.describe('Home page — automatic newsletter popup (GB / en)', () => {
  test.use({ closeNewsletterPopup: false });

  test('"Subscribe to the DaoSense newsletter" pops up by itself, closes with × and opens from "SUBSCRIBE"', async ({ page, store }) => {
    await store.open('/', 'GB');
    const dialog = page.locator('shopify-forms-embed').getByRole('dialog').first();
    await expect(dialog, 'newsletter dialog appears automatically').toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(/Subscribe to the DaoSense newsletter/i);
    await expect(dialog.getByRole('textbox').first()).toBeVisible();

    await page.locator('shopify-forms-embed').getByRole('button', { name: /close/i }).first().click();
    await expect(dialog).toBeHidden();

    // "SUBSCRIBE" buttons ("#" links) open the same dialog
    const subscribe = page.locator('main a.open_newslatter').filter({ visible: true }).first();
    await subscribe.scrollIntoViewIfNeeded();
    await subscribe.click();
    await expect(dialog, '"SUBSCRIBE" opens the newsletter dialog').toBeVisible();
    // "SUBSCRIBE" opens the theme's own .newslatter_popup (inline form), not the Shopify Forms modal:
    // its × is a theme <span class="closebtn"> outside shopify-forms-embed, with no role/name (finding F-21)
    await page.locator('.newslatter_popup .closebtn').click();
    await expect(dialog).toBeHidden();

    // Whether it comes back after a reload is not specified yet — recorded, not asserted.
    await page.reload();
    await page.waitForTimeout(10_000);
    const reappeared = await dialog.isVisible();
    test.info().annotations.push({ type: 'note', description: `newsletter popup after reload: ${reappeared ? 'shown again' : 'not shown'}` });
  });
});

test.describe('Home page — footer and contact form (GB / en)', () => {
  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
  });

  test('footer: policies, social links, e-mail, copyright', async ({ page, store }) => {
    for (const path of POLICIES) {
      expect(await page.locator(`footer a[href$="${path}"], #terms-policies-popover a[href$="${path}"], .footer-utilities a[href$="${path}"]`).count(), `footer links to ${path}`).toBeGreaterThan(0);
    }
    const instagram = page.locator('footer a[href*="instagram.com/daosense"]');
    expect(await instagram.count(), 'Instagram links').toBeGreaterThanOrEqual(3);
    await expect(page.locator(`footer a[href="mailto:${SUPPORT_EMAIL}"]`).first()).toBeAttached();
    await expect(page.locator('p', { hasText: '©' }).last()).toContainText(String(new Date().getFullYear()));

    for (const path of POLICIES) {
      const res = await store.gotoPolitely(store.url(path));
      expect(res?.status(), `${path} opens`).toBe(200);
    }
  });

  test('footer menu links open', async ({ page, store }) => {
    test.slow(); // the link check may have to sit out the store's Retry-After: 60
    const failed = await checkLinks(store, page, await mainLinks(page, 'footer a[href]'), (status) => status >= 400, {
      maxRedirects: 5,
    });
    expect(failed, 'footer links that fail').toEqual([]);
  });

  test('contact form "Let\'s connect": fields are labelled, e-mail is validated, nothing is sent', async ({ page }) => {
    const form = page.locator('form.contact-form__form').first();
    await form.scrollIntoViewIfNeeded();
    await expect(form).toBeVisible();

    for (const name of ['contact[name]', 'contact[email]', 'contact[body]']) {
      const field = form.locator(`[name="${name}"]`);
      await expect(field, `${name} is present`).toBeVisible();
      const id = await field.getAttribute('id');
      expect(id && (await page.locator(`label[for="${id}"]`).count()) > 0, `${name} has a label`).toBe(true);
    }

    const email = form.locator('input[name="contact[email]"]');
    for (const value of ['test@', 'test.com', 'a b@c.d']) {
      await email.fill(value);
      expect(await email.evaluate((el) => (el as HTMLInputElement).checkValidity()), `"${value}" is rejected`).toBe(false);
    }
    await email.fill('qa.test@example.com');
    expect(await email.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(true);
    await expect(form.locator('button[type="submit"]')).toBeEnabled();
    // not submitted: the store sends an e-mail and protects the form with hCaptcha
  });
});
