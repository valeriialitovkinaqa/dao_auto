import { expect, type Locator, type Page } from '@playwright/test';
import { parseMoney } from './money';
import { MARKETS, type Country, type Market } from '../test-data/store';

export interface ShopifyState {
  locale: string;
  country: string;
  currency: string;
}

export interface CartItem {
  key: string;
  handle: string;
  quantity: number;
  /** Line total after discounts, in minor units. */
  final_line_price: number;
  url: string;
  product_title: string;
  properties: Record<string, string> | null;
}

export interface Cart {
  item_count: number;
  currency: string;
  items: CartItem[];
}

export interface AddItem {
  id: number;
  quantity: number;
  properties?: Record<string, string>;
}

const PREVIEW_THEME_ID = process.env.PREVIEW_THEME_ID || '';
const API_RETRIES = 3;
/** Back-off base for HTTP 429 (doubles each retry: 3 s, 6 s, 12 s) unless the store sends Retry-After. */
const RETRY_BASE_MS = 3000;
const MAX_WAIT_MS = 30_000;
/**
 * Longest wait for a link check (see `linkStatus`). The store answers a rate-limited link with
 * `Retry-After: 60`, which `MAX_WAIT_MS` would cut to 30 s — and the retry would be refused again.
 */
const LINK_MAX_WAIT_MS = 65_000;
/**
 * How long all link checks of one test may spend waiting out the rate limit, in total.
 * Without a shared budget a page with several rate-limited links waits 60 s for each of them
 * and the test dies on its own timeout instead of reporting anything (caught 05.11.2026).
 */
const LINK_WAIT_BUDGET_MS = 65_000;

/**
 * The live store rate-limits bursts of requests (HTTP 429) and then shows a bot-verification page.
 * Tests must not try to get past it — they stop with this error so the run can be repeated later
 * with less load (1 worker, no data crawl) or against a dev/preview store.
 */
export class BotChallengeError extends Error {
  constructor(where: string) {
    super(
      `Cloudflare bot check (cf-mitigated: challenge) at ${where}. The store asks this browser to prove it is human — ` +
        'retrying will not help and it must not be bypassed. Stop test runs for a while (30–60 min), ' +
        'or ask the store owner to allow-list the test IP / run against a development or preview store.'
    );
    this.name = 'BotChallengeError';
  }
}

export class RateLimitError extends Error {
  constructor(where: string) {
    super(
      `Storefront rate limit / bot verification hit at ${where}. ` +
        'Wait a few minutes and re-run with fewer requests (workers=1, RUN_DATA_CHECK unset), ' +
        'or run against a development/preview store.'
    );
    this.name = 'RateLimitError';
  }
}

/** Page-object style helpers around the DaoSense storefront. */
export class Storefront {
  /** Same-origin responses the store rate-limited (429) — including the theme's own fetches. */
  readonly rateLimited: string[] = [];
  /** Same-origin responses answered with a Cloudflare bot challenge. */
  readonly challenged: string[] = [];

  constructor(readonly page: Page) {
    const origin = new URL(process.env.BASE_URL || 'https://www.daosense.org').host;
    page.on('response', (r) => {
      if (new URL(r.url()).host !== origin) return;
      if (r.status() === 429) this.rateLimited.push(r.url());
      if (r.headers()['cf-mitigated'] === 'challenge') this.challenged.push(r.url());
    });
  }

  /**
   * Builds a clean storefront URL, exactly as shoppers see it: language prefix + path
   * (e.g. /sv/products/mjalten-i-centrum). No ?country= — the market comes from the region the
   * visitor picked (see setMarket). Only the optional theme preview id is appended.
   */
  url(path: string, market?: Market | Country, extra: Record<string, string> = {}): string {
    const prefix = market ? (typeof market === 'string' ? MARKETS[market] : market).prefix : '';
    const clean = path.startsWith('/') ? path : `/${path}`;
    const full = `${prefix}${clean === '/' && prefix ? '' : clean}` || '/';
    const params = new URLSearchParams(extra);
    if (PREVIEW_THEME_ID) params.set('preview_theme_id', PREVIEW_THEME_ID);
    const query = params.toString();
    return query ? `${full}?${query}` : full;
  }

  /** Country of the market currently stored in the visitor's `localization` cookie (no network call). */
  async currentCountry(): Promise<string | undefined> {
    const cookies = await this.page.context().cookies();
    return cookies.find((c) => c.name === 'localization')?.value;
  }

  /**
   * Picks the region the same way the header "Region and language" selector does: a POST to
   * Shopify's /localization form. Shopify then remembers the market in the `localization` cookie,
   * so every following clean URL opens in that market. Skipped when the market is already active.
   */
  async setMarket(market: Market | Country) {
    const m = typeof market === 'string' ? MARKETS[market] : market;

    // A brand-new visitor must land on the site first (like a real shopper): if the region form is
    // the very first request, Shopify scopes the market cookie to /de or /sv only and then
    // redirects /de/products/… to /products/… without the language prefix.
    if (!this.page.url().startsWith('http')) {
      await this.gotoPolitely(this.url('/'));
      await this.assertNotBlocked();
    }

    if ((await this.currentCountry()) === m.country) return;

    for (let attempt = 0; attempt <= API_RETRIES; attempt++) {
      const res = await this.page.request.post('/localization', {
        form: {
          form_type: 'localization',
          utf8: '✓',
          _method: 'put',
          country_code: m.country,
          locale_code: m.language,
          return_to: m.prefix || '/',
        },
        maxRedirects: 0,
      });
      if (res.status() !== 429) {
        expect([200, 302, 303], `POST /localization for ${m.country} should succeed`).toContain(res.status());
        expect(await this.currentCountry(), `market cookie should switch to ${m.country}`).toBe(m.country);
        return;
      }
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
    throw new RateLimitError(`POST /localization (${m.country})`);
  }

  /**
   * Opens `path` in `market`: selects the region first (if it differs), then navigates to the clean
   * URL. Without `market` the page opens in whatever market the visitor already has.
   */
  async open(path: string, market?: Market | Country, extra: Record<string, string> = {}) {
    if (market) await this.setMarket(market);
    await this.gotoPolitely(this.url(path, market, extra));
    await this.assertNotBlocked();
    await this.passPasswordPageIfNeeded();
    // Guard before any manipulation: the link and the header must both show the expected market.
    if (market) await this.expectMarket(market);
  }

  async openProduct(handle: string, market?: Market | Country) {
    await this.open(`/products/${handle}`, market);
  }

  /**
   * page.goto that honours the store's rate limit: on HTTP 429 it waits (Retry-After, else 3 s → 6 s → 12 s)
   * and tries again. A persistent 429 throws RateLimitError. The bot-verification page is never retried.
   */
  async gotoPolitely(url: string, options?: Parameters<Page['goto']>[1]) {
    for (let attempt = 0; ; attempt++) {
      const response = await this.page.goto(url, options);
      if (response?.headers()['cf-mitigated'] === 'challenge') throw new BotChallengeError(`GET ${url}`);
      if (response?.status() !== 429) return response;
      if (attempt === API_RETRIES) throw new RateLimitError(`GET ${url}`);
      const retryAfter = Number(response.headers()['retry-after']) * 1000;
      await this.page.waitForTimeout(Math.min(retryAfter || RETRY_BASE_MS * 2 ** attempt, MAX_WAIT_MS));
    }
  }

  /**
   * HTTP status of a storefront path, for link checks — without turning the store's rate limit into a defect.
   *
   * A plain `page.request.get` reports 429 like any other status, so a rate-limited link looks exactly like
   * a broken one (BL-12). This waits out one `Retry-After` and then gives up, returning **null**: "not checked".
   * The caller must keep those apart from real non-200 answers.
   */
  async linkStatus(path: string, options: { maxRedirects?: number; retries?: number } = {}): Promise<number | null> {
    const { maxRedirects = 0, retries = 1 } = options;
    for (let attempt = 0; ; attempt++) {
      const res = await this.page.request.get(path, { maxRedirects });
      if (res.headers()['cf-mitigated'] === 'challenge') throw new BotChallengeError(`GET ${path}`);
      if (res.status() !== 429) return res.status();
      if (attempt === retries) return null;
      const retryAfter = Number(res.headers()['retry-after']) * 1000;
      const wait = Math.min(retryAfter || RETRY_BASE_MS * 2 ** attempt, LINK_MAX_WAIT_MS);
      // the test's waiting budget is shared by every link, so one bad page cannot run out the clock
      if (wait > this.linkWaitLeftMs) return null;
      this.linkWaitLeftMs -= wait;
      await this.page.waitForTimeout(wait);
    }
  }

  /** Waiting left for this test's link checks; the fixture builds one Storefront per test. */
  private linkWaitLeftMs = LINK_WAIT_BUDGET_MS;

  /** Fails fast with a clear message when the store answered with its bot-verification page. */
  async assertNotBlocked() {
    const challenge = this.page.getByRole('heading', { name: /connection needs to be verified/i });
    if (await challenge.isVisible().catch(() => false)) throw new BotChallengeError(this.page.url());
  }

  async passPasswordPageIfNeeded() {
    const password = process.env.STOREFRONT_PASSWORD;
    const field = this.page.locator('form[action*="/password"] input[type="password"]');
    if (!password || !(await field.isVisible().catch(() => false))) return;
    await field.fill(password);
    await field.press('Enter');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async state(): Promise<ShopifyState> {
    return this.page.evaluate(() => {
      const s = (window as any).Shopify || {};
      return { locale: s.locale || '', country: s.country || '', currency: s.currency?.active || '' };
    });
  }

  /** Market shown in the header: the country ticked in the region list + the currency code on the selector button. */
  async headerMarket(): Promise<{ country: string | null; currency: string | null }> {
    const selected = this.page.locator('[id$="country-results"] li[aria-current="true"]').first();
    const currency = this.page.locator('[data-testid="localization-currency-code"], .currency-code').first();
    return {
      country: (await selected.count()) ? await selected.getAttribute('data-value') : null,
      currency: (await currency.count()) ? ((await currency.textContent()) || '').trim() : null,
    };
  }

  /**
   * Asserts the page really is in `market` before a test touches anything:
   * 1. the link — language prefix of the URL (/de, /sv, none for English);
   * 2. the header — selected country and currency in the "Region and language" selector;
   * 3. Shopify's own state (window.Shopify locale / country / currency).
   * Catches e.g. https://www.daosense.org/ opening with Sweden still selected in the header.
   */
  async expectMarket(market: Market | Country) {
    const m = typeof market === 'string' ? MARKETS[market] : market;
    const expected = `${m.country} / ${m.language} / ${m.currency}`;

    const { pathname } = new URL(this.page.url());
    const prefix = pathname.match(/^\/(de|sv)(\/|$)/)?.[1] || '';
    expect(prefix ? `/${prefix}` : '', `link ${pathname} should use the language prefix of ${expected}`).toBe(m.prefix);

    await expect
      .poll(() => this.headerMarket(), { message: `header region selector should show ${m.country} / ${m.currency} (page ${pathname})` })
      .toEqual({ country: m.country, currency: m.currency });

    await expect
      .poll(() => this.state(), { message: `storefront should be in market ${expected} (page ${pathname})` })
      .toEqual({ locale: m.language, country: m.country, currency: m.currency });
  }

  // ---------- Cart (AJAX API, run inside the page so cookies + market match the browser) ----------

  /**
   * Calls the Shopify AJAX API from inside the page (same cookies + market as the browser).
   * HTTP 429 is retried with back-off (honouring Retry-After); a persistent 429 throws RateLimitError.
   */
  async api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    const result = await this.page.evaluate(
      async ({ method, path, body, retries, retryBaseMs, maxWaitMs }) => {
        const root = (window as any).Shopify?.routes?.root || '/';
        const url = `${root}${path.replace(/^\//, '')}`;
        let res: Response | null = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
          res = await fetch(url, {
            method,
            cache: 'no-store',
            headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
          if (res.headers.get('cf-mitigated') === 'challenge' || res.status !== 429 || attempt === retries) break;
          const wait = Number(res.headers.get('Retry-After')) * 1000 || retryBaseMs * 2 ** attempt;
          await new Promise((r) => setTimeout(r, Math.min(wait, maxWaitMs)));
        }
        const text = await res!.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          /* non-JSON body (HTML error / challenge page) */
        }
        return { status: res!.status, data, challenged: res!.headers.get('cf-mitigated') === 'challenge' };
      },
      { method, path, body, retries: API_RETRIES, retryBaseMs: RETRY_BASE_MS, maxWaitMs: MAX_WAIT_MS }
    );
    if (result.challenged) throw new BotChallengeError(`${method} ${path}`);
    if (result.status === 429) throw new RateLimitError(`${method} ${path}`);
    return result as { status: number; data: T | null };
  }

  async cart(): Promise<Cart> {
    const { status, data } = await this.api<Cart>('GET', 'cart.js');
    expect(status, 'cart.js should respond 200').toBe(200);
    return data as Cart;
  }

  async clearCart() {
    await this.api('POST', 'cart/clear.js');
  }

  /** Resolves the first available variant id of a product reachable in the current market. */
  async variantId(handle: string): Promise<number> {
    const { status, data } = await this.api('GET', `products/${handle}.js`);
    expect(status, `product "${handle}" should be reachable in the current market`).toBe(200);
    const variant = data.variants.find((v: any) => v.available) || data.variants[0];
    return variant.id as number;
  }

  async addToCart(items: AddItem[]) {
    const { status } = await this.api('POST', 'cart/add.js', { items });
    expect(status, 'cart/add.js should succeed').toBe(200);
  }

  async addProduct(handle: string, quantity = 1, properties?: Record<string, string>) {
    await this.addToCart([{ id: await this.variantId(handle), quantity, properties }]);
  }

  /**
   * Waits for cart-market-validation.js to finish on the current page: it stores the validated
   * country in sessionStorage and releases the `is-market-switching` lock.
   */
  async waitForCartSync() {
    try {
      await expect
        .poll(
          () =>
            this.page.evaluate(
              () =>
                sessionStorage.getItem('cartMarketValidatedFor') === ((window as any).Shopify?.country || '') &&
                !document.documentElement.classList.contains('is-market-switching')
            ),
          {
            message: 'cart market sync should finish (cart-market-validation.js sets sessionStorage.cartMarketValidatedFor)',
            timeout: 20_000,
          }
        )
        .toBe(true);
    } catch (error) {
      // The theme's own /cart.js call got a 429 → its sync script aborted; report the real cause.
      if (this.challenged.length) throw new BotChallengeError(this.challenged[0]);
      if (this.rateLimited.length) throw new RateLimitError(this.rateLimited[0]);
      throw error;
    }
  }

  // ---------- Locators ----------

  get notices(): Locator {
    return this.page.locator('.cart-market-notice');
  }

  get lockedRoot(): Locator {
    return this.page.locator('html.is-market-switching');
  }

  get checkoutButton(): Locator {
    return this.page.locator('#checkout');
  }

  /** Cart line rows (cart page and cart drawer share the same markup). */
  get cartRows(): Locator {
    return this.page.locator('cart-items-component [ref="cartItemRows[]"]');
  }

  /** Remove (bin) buttons of the cart lines. */
  get cartRemoveButtons(): Locator {
    return this.page.locator('cart-items-component .cart-items__remove');
  }

  /** Quantity stepper controls in the cart (minus / input / plus) — currently not rendered by the theme. */
  get cartStepperControls(): Locator {
    return this.page.locator(
      'cart-items-component .quantity-minus, cart-items-component .quantity-plus, cart-items-component input[name="updates[]"]'
    );
  }

  /** Line total shown for each cart row. */
  get cartLinePrices(): Locator {
    return this.page.locator('cart-items-component .cart-items__price text-component');
  }

  /** "Estimated total" in the cart summary. */
  get cartTotal(): Locator {
    return this.page.locator('.cart__total-value').first();
  }

  // ---------- Header / footer (selectors taken from the live markup, 2026-10-19) ----------

  get header(): Locator {
    return this.page.locator('header-component, header').first();
  }

  /** Desktop main menu links (Blog, Workbooks, Membership, FAQ, Contact). */
  get mainMenuLinks(): Locator {
    return this.page.locator('header-component nav[header-menu] a.menu-list__link');
  }

  get searchButton(): Locator {
    return this.page.locator('button.search-modal__button').filter({ visible: true }).first();
  }

  get searchModal(): Locator {
    return this.page.locator('#search-modal dialog');
  }

  get predictiveInput(): Locator {
    return this.page.locator('predictive-search-component input.search-input').first();
  }

  get predictiveProducts(): Locator {
    return this.page.locator('#predictive-search-products li.predictive-search-results__card--product');
  }

  get accountButton(): Locator {
    return this.page.locator('.account-button').filter({ visible: true }).first();
  }

  get accountPopover(): Locator {
    return this.page.locator('#account-popover');
  }

  get cartDrawerTrigger(): Locator {
    return this.page.locator('button[data-testid="cart-drawer-trigger"]').filter({ visible: true }).first();
  }

  get cartDrawer(): Locator {
    return this.page.locator('cart-drawer-component dialog.cart-drawer__dialog');
  }

  get cartBubbleCount(): Locator {
    return this.page.locator('[data-testid="cart-bubble"]').first();
  }

  get mobileMenuToggle(): Locator {
    return this.page.locator('header-drawer summary.header__icon--menu');
  }

  get mobileMenuLinks(): Locator {
    return this.page.locator('a.menu-drawer__menu-item--mainlist');
  }

  get footer(): Locator {
    return this.page.locator('footer').first();
  }

  // ---------- Collection / search ----------

  /** Product cards of the main grid (excludes "product list" sections elsewhere on the page). */
  get gridCards(): Locator {
    return this.page.locator('ul[data-testid="product-grid"] li.product-grid__item product-card');
  }

  get productsCount(): Locator {
    return this.page.locator('[data-testid="products-count"]').first();
  }

  /** "13 items" → 13 */
  async productsCountValue(): Promise<number> {
    const text = (await this.productsCount.innerText()).trim();
    return Number(text.match(/\d+/)?.[0] ?? NaN);
  }

  /** Handles of the cards in the main grid, in display order. */
  async gridHandles(): Promise<string[]> {
    return this.gridCards.evaluateAll((cards) =>
      cards.map((c) => (c.querySelector('a.product-card__link') as HTMLAnchorElement | null)?.pathname.split('/products/')[1] || '')
    );
  }

  /** Prices of the cards in the main grid, minor units. */
  async gridPrices(): Promise<number[]> {
    const texts = await this.gridCards.locator('product-price .price').allInnerTexts();
    return texts.map((t) => parseMoney(t));
  }

  get pdpLanguageSelect(): Locator {
    return this.page.locator('[data-pdp-language-select]').first();
  }

  get pdpLanguageInput(): Locator {
    return this.page.locator('[data-pdp-language-input]').first();
  }

  get pdpAddButton(): Locator {
    return this.page.locator('form[data-type="add-to-cart-form"] button[name="add"]').first();
  }

  get marketPopup(): Locator {
    return this.page.locator('#market-popup');
  }

  /** Main product price on the PDP (first price block of the product information section). */
  get pdpPrice(): Locator {
    return this.page.locator('main [ref="priceContainer"] .price').first();
  }

  get pdpCompareAtPrice(): Locator {
    return this.page.locator('main [ref="priceContainer"] .compare-at-price').first();
  }

  /** "Member price" block on the PDP (.member-price-note). */
  get memberPriceNote(): Locator {
    return this.page.locator('main .member-price-note').first();
  }

  /** Text after a label inside the Member price block, e.g. memberPriceValue('Member price') → "£10.05". */
  async memberPriceValue(label: 'Member price' | 'Regular price' | 'Your price'): Promise<string> {
    const line = this.memberPriceNote.locator('p').filter({ hasText: `${label}:` }).first();
    await expect(line, `"${label}:" line should be shown`).toBeVisible();
    return ((await line.innerText()).split(`${label}:`)[1] || '').trim();
  }

  /** Price of the first variant of `handle` in the current market, minor units (from /products/<handle>.js). */
  async productPrice(handle: string): Promise<number> {
    const { status, data } = await this.api('GET', `products/${handle}.js`);
    expect(status, `product "${handle}" should be reachable in the current market`).toBe(200);
    const variant = data.variants.find((v: any) => v.available) || data.variants[0];
    return variant.price as number;
  }

  /** Desktop header "Region and language" selector (mobile uses the menu drawer instead). */
  get headerRegionButton(): Locator {
    return this.page.locator('header .dropdown-localization__button').first();
  }

  /** Picks a country in the header region selector, like a shopper would. Submits the localization form. */
  async switchCountryInHeader(country: Country) {
    await this.headerRegionButton.click();
    await this.page.locator(`#dropdown-country-results li[data-value="${country}"]`).click();
  }

  /** Picks a language in the header region selector (each language is paired with its own market).
   *
   * The theme hides the native <select id="dropdownSelect"> under a styled custom control, so
   * Playwright's visibility check fails; we select the option directly and dispatch 'change' so the
   * theme's on:change handler runs. (A visible click on the custom control would also work, but it
   * is rebuilt per market and the labels are localized.)
   */
  async switchLanguageInHeader(language: string) {
    await this.headerRegionButton.click();
    await this.page.locator('#dropdownSelect').selectOption(language, { force: true });
  }

  /** Reads the server-rendered cross-language map from the PDP product form. */
  async languageProductMap(): Promise<Record<string, unknown>> {
    const raw = await this.page
      .locator('product-form-component[data-language-product-map]')
      .first()
      .getAttribute('data-language-product-map');
    return JSON.parse(raw || '{}');
  }

  /** Picks a language on the PDP selector and presses "Add to cart" (triggers the /localization round-trip). */
  async switchLanguageAndAdd(language: string) {
    await this.pdpLanguageSelect.selectOption(language);
    await this.pdpAddButton.click();
  }

  /**
   * Waits until the browser lands on `pathname` (query string ignored) and the page is loaded.
   * With `market`, also checks the link + header market before the test continues.
   */
  async waitForPath(pathname: string | RegExp, market?: Market | Country) {
    await this.page.waitForURL(
      (u) => (typeof pathname === 'string' ? u.pathname === pathname : pathname.test(u.pathname)),
      { waitUntil: 'load', timeout: 30_000 }
    );
    await this.assertNotBlocked();
    if (market) await this.expectMarket(market);
  }
}
