import { test, expect } from '../../helpers/fixtures';

/**
 * SMK-022, 023 — predictive search and the search results page.
 * Collection page checks (former SMK-005…010) moved to tests/pages/collections*.spec.ts (PLP-001…016).
 */

test.describe('Search', () => {
  test('SMK-022 predictive search suggests products while typing and opens the picked one', async ({ page, store, isMobile }) => {
    test.skip(!!isMobile, 'desktop search dialog');
    await store.open('/', 'GB');
    await store.searchButton.click();
    await store.predictiveInput.fill('heart');

    await expect(store.predictiveProducts.first()).toBeVisible();
    const href = await store.predictiveProducts.first().locator('a').first().getAttribute('href');
    await store.predictiveProducts.first().locator('a').first().click();
    await page.waitForURL((u) => u.pathname === new URL(href || '/', page.url()).pathname);
  });

  test('SMK-023 results page: matches for "liver", empty state for nonsense, script text is not executed', async ({ page, store }) => {
    let dialogs = 0;
    page.on('dialog', async (d) => {
      dialogs += 1;
      await d.dismiss();
    });

    await store.open('/search', 'GB', { q: 'liver', type: 'product' });
    const found = await store.gridCards.count();
    expect(found, 'results for "liver"').toBeGreaterThan(0);
    expect(await store.productsCountValue(), 'count text matches results').toBe(found);

    // No matches: the theme shows the "no results" message, no "N items" count, and then a fallback
    // "Products" list of the catalogue (h4.main-collection-grid__title) — those cards are not search results.
    await store.open('/search', 'GB', { q: 'zzzzqq', type: 'product' });
    await expect(page.locator('.search-results__no-results'), 'no-results message').toBeVisible();
    await expect(page.locator('.search-results__no-results'), 'the message repeats the query').toContainText('zzzzqq');
    await expect(store.productsCount, 'no "N items" for an empty search').toHaveCount(0);

    await store.open('/search', 'GB', { q: '<script>alert(1)</script>' });
    await page.waitForTimeout(1_000);
    expect(dialogs, 'no alert from the query').toBe(0);
    await expect(page.locator('input.search-page-input[name=q]')).toHaveValue('<script>alert(1)</script>');
  });
});
