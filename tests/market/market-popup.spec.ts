import { test, expect } from '../../helpers/fixtures';
import { MARKETS, type Country } from '../../test-data/store';

/**
 * MKT-001…005 — first-visit country/region popup (snippets/market-popup.liquid, DAO-11).
 * The popup only renders when Header → "Show market popup" is on (off in the repo by default),
 * so the suite is opt-in via MARKET_POPUP_ENABLED=true.
 */
test.describe('Market popup', () => {
  test.skip(process.env.MARKET_POPUP_ENABLED !== 'true', 'Market popup is disabled on the theme under test');
  test.use({ marketPopupSeen: false });

  test('MKT-001 shows the popup with 4 regions on first visit', async ({ store }) => {
    await store.open('/');

    await expect(store.marketPopup).toHaveClass(/\bactive\b/);
    await expect(store.marketPopup.locator('#country-results li')).toHaveCount(4);
    for (const name of ['Germany', 'Sweden', 'United Kingdom', 'United States']) {
      await expect(store.marketPopup.getByText(name, { exact: true })).toBeVisible();
    }
  });

  const choices: Array<{ label: string; country: Country }> = [
    { label: 'Germany', country: 'DE' },
    { label: 'Sweden', country: 'SE' },
    { label: 'United Kingdom', country: 'GB' },
    { label: 'United States', country: 'US' },
  ];

  for (const { label, country } of choices) {
    test(`MKT-002/003 picking "${label}" switches to ${country}`, async ({ page, store }) => {
      const market = MARKETS[country];
      await store.open('/');

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        store.marketPopup.locator(`li[data-country="${country}"]`).click(),
      ]);

      await store.expectMarket(market);
      if (market.prefix) expect(new URL(page.url()).pathname.startsWith(market.prefix)).toBe(true);
      await expect(store.marketPopup).not.toHaveClass(/\bactive\b/);
    });
  }

  test('MKT-004 does not show the popup again after a region was picked', async ({ page, store }) => {
    await store.open('/');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      store.marketPopup.locator('li[data-country="GB"]').click(),
    ]);

    expect(await page.evaluate(() => localStorage.getItem('market_selected'))).toBe('true');

    for (const path of ['/', '/collections/all', '/cart']) {
      await store.open(path);
      await expect(store.marketPopup, `popup should stay hidden on ${path}`).not.toHaveClass(/\bactive\b/);
    }
  });

  test('MKT-005 each region shows its own flag', async ({ store }) => {
    // Known risk R-04: flags are picked by index from localization.available_countries, not by code.
    await store.open('/');

    for (const country of ['DE', 'SE', 'GB', 'US']) {
      const style = await store.marketPopup
        .locator(`li[data-country="${country}"] .icon-flag`)
        .getAttribute('style');
      // Shopify flag URLs look like .../flags/gb.svg?width=32
      expect(style?.toLowerCase(), `flag image for ${country}`).toContain(`flags/${country.toLowerCase()}.svg`);
    }
  });
});

/** A11Y-005, TRN-004 — popup accessibility and translations (also opt-in via MARKET_POPUP_ENABLED). */
test.describe('Market popup — a11y and translations', () => {
  test.skip(process.env.MARKET_POPUP_ENABLED !== 'true', 'Market popup is disabled on the theme under test');
  test.use({ marketPopupSeen: false });

  test('A11Y-005 regions can be chosen with the keyboard and the popup can be closed', async ({ page, store }) => {
    // Known risk R-11: regions are plain <li> without tabindex and there is no close control.
    test.info().annotations.push({ type: 'known-risk', description: 'R-11' });
    await store.open('/');
    await expect(store.marketPopup).toHaveClass(/\bactive\b/);

    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => !!document.activeElement?.closest('#market-popup li'));
    }
    expect(reached, 'a region in the popup gets keyboard focus').toBe(true);

    await page.keyboard.press('Escape');
    await expect(store.marketPopup, 'Esc closes the popup').not.toHaveClass(/\bactive\b/);
  });

  for (const market of ['DE', 'SE'] as const) {
    test(`TRN-004 popup texts are translated (${market})`, async ({ store }) => {
      test.info().annotations.push({ type: 'known-risk', description: 'R-11: texts are hard-coded English' });
      await store.open('/', market);
      await expect(store.marketPopup.locator('h3')).not.toHaveText(/Please select your region/i);
    });
  }
});

/** MKT-008 — the popup setting on the theme under test matches what the team expects (MARKET_POPUP_ENABLED). */
test('MKT-008 market popup is rendered exactly when it is expected to be enabled', async ({ page, store }) => {
  await store.open('/', 'GB');
  const rendered = (await page.locator('#market-popup').count()) > 0;
  const expected = process.env.MARKET_POPUP_ENABLED === 'true';
  test.info().annotations.push({ type: 'note', description: `popup rendered: ${rendered}, expected: ${expected}` });
  expect(rendered, 'Header → "Show market popup" matches MARKET_POPUP_ENABLED').toBe(expected);
});
