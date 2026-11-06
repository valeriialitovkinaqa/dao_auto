import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { Storefront } from './storefront';
import { COLLECTIONS, CURRENCY_SYMBOL, type Market } from '../test-data/store';

/**
 * Collection page (PLP) checks shared by tests/pages/collections*.spec.ts — one suite per market.
 * Selectors from the live markup (2026-10-20):
 *  - grid: ul[data-testid="product-grid"] (data-last-page) › li.product-grid__item › product-card
 *  - card: a.product-card__link (whole card), a[ref="productTitleLink"] (`display: contents` — click its text), product-price .price
 *  - facets: details.facets__panel › input[name="filter.p.m.custom.categories"] + label[role=checkbox], button.facets__clear-all;
 *    "Price": input[name="filter.v.price.gte"|"filter.v.price.lte"] — on live only in GB (F-23)
 *  - sorting: input.sorting-filter__input[name="sort_by"]
 *  - empty result: .main-collection-grid__empty with a.main-collection-grid__empty-link ("clear all filters")
 * Collection handles are the same in every language: /collections/workbooks, /de/collections/workbooks, /sv/collections/workbooks.
 */

export const WORKBOOKS = `/collections/${COLLECTIONS.workbooks}`;
export const ALL = `/collections/${COLLECTIONS.allEn}`;
export const OTHER_COLLECTIONS = ['courses', 'bundles', 'best-sellers'];

const CATEGORY = 'filter.p.m.custom.categories';

export const SORTS: Array<{ value: string; check: 'price-asc' | 'price-desc' | 'title-asc' | 'title-desc' | 'any' }> = [
  { value: 'manual', check: 'any' }, // "Featured"
  { value: 'most-relevant', check: 'any' },
  { value: 'best-selling', check: 'any' },
  { value: 'title-ascending', check: 'title-asc' },
  { value: 'title-descending', check: 'title-desc' },
  { value: 'price-ascending', check: 'price-asc' },
  { value: 'price-descending', check: 'price-desc' },
  { value: 'created-ascending', check: 'any' },
  { value: 'created-descending', check: 'any' },
];

const emptyState = (page: Page) => page.locator('.main-collection-grid__empty');

/** Card titles in display order (textContent: innerText would apply CSS text-transform). */
export async function gridTitles(store: Storefront): Promise<string[]> {
  return store.gridCards.locator('a[ref="productTitleLink"]').evaluateAll((as) => as.map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim()));
}

/** Handles of every product of a collection, walking all pages (data-last-page). */
export async function allPagesHandles(page: Page, store: Storefront, path: string, market: Market): Promise<string[][]> {
  await store.open(path, market);
  const lastPage = Number(await page.locator('ul[data-testid="product-grid"]').getAttribute('data-last-page')) || 1;
  const pages = [await store.gridHandles()];
  for (let p = 2; p <= lastPage; p++) {
    await store.open(path, market, { page: String(p) });
    pages.push(await store.gridHandles());
  }
  return pages;
}

/** The visible "Category" facet (the theme renders it twice: desktop bar + mobile drawer). */
const categoryFacet = (page: Page) =>
  page.locator('details.facets__panel').filter({ has: page.locator(`input[name="${CATEGORY}"]`) }).filter({ visible: true }).first();

/** First category value offered by the facet (values are translated per language, so they are read, not hard-coded). */
async function firstCategoryValue(page: Page): Promise<string> {
  const value = await page.locator(`input[name="${CATEGORY}"]`).first().getAttribute('value');
  expect(value, 'the "Category" facet offers at least one value').toBeTruthy();
  return value as string;
}

/** The visible "Price" facet (from/to inputs filter.v.price.gte / .lte). */
const priceFacet = (page: Page) =>
  page.locator('details.facets__panel').filter({ has: page.locator('input[name="filter.v.price.gte"]') }).filter({ visible: true }).first();

const sorted = <T>(a: T[], cmp: (x: T, y: T) => number) => [...a].sort(cmp);

/** Registers the collection page suite for one market. */
export function collectionPageSuite(market: Market) {
  const where = `${market.country} / ${market.language}`;
  const prefix = market.prefix;

  test.describe(`Collection page — ${where}`, () => {
    test(`PLP-001 opens ${prefix}${WORKBOOKS} in ${market.language} with the product grid`, async ({ page, store }) => {
      await store.open(WORKBOOKS, market); // also checks link + header + Shopify state
      expect(await page.locator('html').getAttribute('lang')).toBe(market.language);
      await expect(page.locator('main h1').first()).toBeVisible();
      expect(await store.gridCards.count(), 'cards in the grid').toBeGreaterThan(0);
      expect(await page.content()).not.toMatch(/translation missing/i);
    });

    test('PLP-002 "N items" matches the cards in the grid (all pages)', async ({ page, store }) => {
      const pages = await allPagesHandles(page, store, WORKBOOKS, market);
      expect(pages.flat().length, '"N items" = cards on all pages').toBe(await store.productsCountValue());
    });

    test(`PLP-003 every card shows an image, a title and a price in ${market.currency}`, async ({ store }) => {
      await store.open(WORKBOOKS, market);
      for (const card of await store.gridCards.all()) {
        const handle = await card.locator('a.product-card__link').getAttribute('href');
        await expect(card.locator('img').first(), `${handle}: image`).toHaveAttribute('src', /.+/);
        await expect(card.locator('img').first(), `${handle}: image has alt`).toHaveAttribute('alt');
        await expect(card.locator('a[ref="productTitleLink"]'), `${handle}: title`).toHaveText(/\S/);
        await expect(card.locator('product-price .price').first(), `${handle}: price in ${market.currency}`).toHaveText(CURRENCY_SYMBOL[market.currency]);
      }
    });

    test(`PLP-004 product links keep the ${prefix || 'English (no)'} prefix and open in this market`, async ({ store }) => {
      await store.open(WORKBOOKS, market);
      const paths = await store.gridCards.locator('a.product-card__link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
      expect(paths.length).toBeGreaterThan(0);

      const wrongPrefix = paths.filter((p) => (prefix ? !p.startsWith(`${prefix}/products/`) : !/^\/products\//.test(p)));
      expect(wrongPrefix, `product links without the ${prefix || 'English'} prefix`).toEqual([]);

      // a product of another market answers 404 in this one
      const broken: string[] = [];
      for (const path of paths) {
        const handle = path.split('/products/')[1];
        const { status } = await store.api('GET', `products/${handle}.js`);
        if (status !== 200) broken.push(`${handle} → ${status}`);
      }
      expect(broken, `products that do not open in ${market.country}`).toEqual([]);
    });

    test('PLP-005 a card title opens its product page in the same market', async ({ page, store }) => {
      await store.open(WORKBOOKS, market);
      const titleLink = store.gridCards.first().locator('a[ref="productTitleLink"]');
      const title = ((await titleLink.textContent()) || '').replace(/\s+/g, ' ').trim();
      // the link itself is `display: contents` (no box to click) — click its visible title text
      await titleLink.getByText(title).first().click();
      await page.waitForURL(/\/products\//);
      await store.expectMarket(market);
      await expect(page.locator('main h1').first()).toHaveText(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    });

    // images must load here — turn the asset blocking off for this test only
    test.describe(() => {
      test.use({ loadAssets: true });

      test('PLP-006 product images load', async ({ store }) => {
        await store.open(WORKBOOKS, market);
        for (const card of await store.gridCards.all()) {
          const img = card.locator('img').first();
          await img.scrollIntoViewIfNeeded(); // lazy-loaded
          await expect
            .poll(() => img.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), {
              message: `image of ${await card.locator('a.product-card__link').getAttribute('href')} loads`,
            })
            .toBe(true);
        }
      });
    });

    test('PLP-007 "Category" filter narrows the grid, is in the URL and "Clear all" resets it', async ({ page, store }) => {
      await store.open(WORKBOOKS, market);
      const total = await store.productsCountValue();
      const value = await firstCategoryValue(page);

      const facet = categoryFacet(page);
      await facet.locator('summary').click();
      // toggled with the keyboard (focus + Space): right after opening, the floating panel still moves,
      // so a pointer click can land on another item (seen: hover-prefetch of "Metal" instead of "Earth")
      const checkbox = facet.locator(`input[name="${CATEGORY}"][value="${value}"]`);
      await checkbox.focus();
      await page.keyboard.press('Space');
      await expect(checkbox, `"${value}" is checked`).toBeChecked();

      await page.waitForURL((u) => u.searchParams.getAll(CATEGORY).includes(value));
      await expect.poll(() => store.productsCountValue(), 'filtered "N items"').toBeLessThan(total);
      expect(await store.productsCountValue(), 'the filter still finds products').toBeGreaterThan(0);
      await expect.poll(() => store.gridCards.count(), 'cards = filtered "N items"').toBe(await store.productsCountValue());
      expect(new URL(page.url()).pathname, 'the language prefix is kept').toBe(`${prefix}${WORKBOOKS}`);

      await page.locator('button.facets__clear-all').filter({ visible: true }).first().click();
      await page.waitForURL((u) => !u.searchParams.has(CATEGORY));
      await expect.poll(() => store.productsCountValue(), '"Clear all" brings back every product').toBe(total);
    });

    test('PLP-008 every sort option is offered and orders the grid', async ({ page, store }) => {
      await store.open(WORKBOOKS, market);
      const offered = await page.locator('input.sorting-filter__input[name="sort_by"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      for (const { value } of SORTS) expect(offered, `sort option ${value} is offered`).toContain(value);

      // soft: one run reports every broken sort option, not only the first (e.g. DE: F-24 title + F-25 price)
      for (const { value, check } of SORTS) {
        await store.open(WORKBOOKS, market, { sort_by: value });
        const prices = await store.gridPrices();
        const titles = (await gridTitles(store)).map((t) => t.toLocaleLowerCase(market.language));
        // Shopify orders titles accent-insensitively (ä ≈ a), not by Swedish/German collation where å/ä/ö come after z:
        // live /sv: "Träelementet" before "Traumaarbete…"
        const byTitle = new Intl.Collator('en', { sensitivity: 'base' }).compare;
        expect.soft(prices.length, `${value} shows products`).toBeGreaterThan(0);
        if (check === 'price-asc') expect.soft(prices, value).toEqual(sorted(prices, (a, b) => a - b));
        if (check === 'price-desc') expect.soft(prices, value).toEqual(sorted(prices, (a, b) => b - a));
        if (check === 'title-asc') expect.soft(titles, value).toEqual(sorted(titles, (a, b) => byTitle(a, b)));
        if (check === 'title-desc') expect.soft(titles, value).toEqual(sorted(titles, (a, b) => byTitle(b, a)));
      }
    });

    test('PLP-009 the chosen sort is kept in the URL and after a reload', async ({ page, store }) => {
      await store.open(WORKBOOKS, market, { sort_by: 'price-descending' });
      await page.reload();
      await store.expectMarket(market);
      expect(new URL(page.url()).searchParams.get('sort_by'), 'sort is kept after reload').toBe('price-descending');
      await expect(page.locator('input.sorting-filter__input[value="price-descending"]').first()).toBeChecked();
    });

    test('PLP-010 "Category" filter and sorting combine', async ({ page, store }) => {
      await store.open(WORKBOOKS, market);
      const total = await store.productsCountValue();
      const value = await firstCategoryValue(page);

      await store.open(WORKBOOKS, market, { [CATEGORY]: value, sort_by: 'price-descending' });
      const url = new URL(page.url());
      expect(url.searchParams.getAll(CATEGORY), 'filter in the URL').toContain(value);
      expect(url.searchParams.get('sort_by'), 'sort in the URL').toBe('price-descending');

      const count = await store.productsCountValue();
      expect(count, 'filtered').toBeLessThan(total);
      expect(count, 'filtered').toBeGreaterThan(0);
      const prices = await store.gridPrices();
      expect(prices, 'filtered products are sorted by price, high to low').toEqual(sorted(prices, (a, b) => b - a));
    });

    test('PLP-011 a filter that matches nothing shows the empty state with a way back', async ({ page, store }) => {
      await store.open(WORKBOOKS, market);
      const total = await store.productsCountValue();

      await store.open(WORKBOOKS, market, { [CATEGORY]: 'qa-no-such-category' });
      expect(await store.productsCountValue(), '"0 items"').toBe(0);
      await expect(store.gridCards).toHaveCount(0);
      await expect(emptyState(page), 'empty-state message').toBeVisible();
      await expect(emptyState(page).getByRole('heading')).toHaveText(/\S/);

      const back = emptyState(page).locator('a.main-collection-grid__empty-link');
      await expect(back, '"clear all filters" keeps the language prefix').toHaveAttribute('href', `${prefix}${WORKBOOKS}`);
      await back.click();
      await page.waitForURL((u) => u.pathname === `${prefix}${WORKBOOKS}` && !u.searchParams.has(CATEGORY));
      await expect.poll(() => store.productsCountValue()).toBe(total);
    });

    test(`PLP-012 ${prefix}${ALL}: pages have no duplicates and add up to "N items"`, async ({ page, store }) => {
      const pages = await allPagesHandles(page, store, ALL, market);
      const handles = pages.flat();
      expect(handles.length, 'products listed').toBeGreaterThan(0);
      expect(handles.filter((h, i) => handles.indexOf(h) !== i), 'duplicates across pages').toEqual([]);
      expect(handles.length, 'products on all pages = "N items"').toBe(await store.productsCountValue());
      test.info().annotations.push({ type: 'note', description: `pages: ${pages.length}, products: ${handles.length}` });
    });

    test('PLP-013 browser Back from a product returns to the same filtered and sorted collection', async ({ page, store }) => {
      await store.open(WORKBOOKS, market, { sort_by: 'price-ascending' });
      const before = new URL(page.url());
      const handles = await store.gridHandles();

      // a.product-card__link lies underneath the card content — click the title text (the title link is `display: contents`)
      const titleLink = store.gridCards.first().locator('a[ref="productTitleLink"]');
      const title = ((await titleLink.textContent()) || '').replace(/\s+/g, ' ').trim();
      await titleLink.getByText(title).first().click();
      await page.waitForURL(/\/products\//);
      await page.goBack();

      await page.waitForURL((u) => u.pathname === before.pathname && u.search === before.search);
      await store.expectMarket(market);
      await expect.poll(() => store.gridHandles(), 'same products in the same order').toEqual(handles);
    });

    // The "Price" facet is rendered only in GB on live — missing in US, DE, SE (finding F-23).
    test(`PLP-015 "Price" filter is offered and keeps only products within the range (${market.currency})`, async ({ page, store }) => {
      await store.open(WORKBOOKS, market);
      const facet = priceFacet(page);
      await expect(facet, `"Price" filter is offered in ${market.country} (F-23)`).toBeAttached();

      const total = await store.productsCountValue();
      const prices = await store.gridPrices();
      const min = Math.min(...prices);
      expect(Math.max(...prices), 'the grid has more than one price, so a range can narrow it').toBeGreaterThan(min);
      // the cheapest price only — taken from the grid, never hard-coded
      const bound = (min / 100).toFixed(2);

      await facet.locator('summary').click();
      await facet.locator('input[name="filter.v.price.gte"]').fill(bound);
      await facet.locator('input[name="filter.v.price.lte"]').fill(bound);
      await facet.locator('input[name="filter.v.price.lte"]').press('Enter');

      await page.waitForURL((u) => u.searchParams.has('filter.v.price.gte') && u.searchParams.has('filter.v.price.lte'));
      expect(new URL(page.url()).pathname, 'the language prefix is kept').toBe(`${prefix}${WORKBOOKS}`);
      await expect.poll(() => store.productsCountValue(), 'filtered "N items"').toBeLessThan(total);
      const filtered = await store.gridPrices();
      expect(filtered.length, 'the range still finds products').toBeGreaterThan(0);
      expect(filtered.filter((p) => p !== min), `prices outside ${bound}–${bound}`).toEqual([]);
    });

    for (const [name, gte, lte] of [
      ['inverted ("from" > "to")', '20', '5'],
      ['negative', '-5', '-1'],
      ['letters', 'abc', 'xyz'],
    ]) {
      test(`PLP-016 ${name} price range in the URL does not break the page`, async ({ page, store }) => {
        await store.open(WORKBOOKS, market);
        const res = await store.gotoPolitely(store.url(WORKBOOKS, market, { 'filter.v.price.gte': gte, 'filter.v.price.lte': lte }));
        expect(res?.status(), 'the page still renders').toBe(200);
        await store.expectMarket(market);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(store.gridCards.first().or(emptyState(page)), 'products or the empty state').toBeVisible();
      });
    }

    for (const handle of OTHER_COLLECTIONS) {
      test(`PLP-014 ${prefix}/collections/${handle} opens with products or an empty state`, async ({ page, store }) => {
        await store.open(`/collections/${handle}`, market);
        expect(await page.locator('html').getAttribute('lang')).toBe(market.language);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(store.gridCards.first().or(emptyState(page)), 'products or the empty state').toBeVisible();
        expect(await store.productsCountValue(), '"N items" = cards').toBe(await store.gridCards.count());
      });
    }
  });
}
