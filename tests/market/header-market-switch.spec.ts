import { test, expect } from '../../helpers/fixtures';
import { GROUPS, MARKETS, MARKET_FOR_LANGUAGE, type Country, type Language } from '../../test-data/store';

/**
 * MKT-031…032 — switching region / language in the HEADER while on a product page.
 * Expected behaviour (confirmed by the team, 2026-10-19): the shopper lands on the HOME PAGE of
 * the selected market, not on the equivalent product (each language's product is a separate,
 * market-restricted product). Market prefix: /de, /sv, none for GB/US.
 *
 * Desktop only: on mobile the selector lives in the menu drawer.
 */

const homePath = (prefix: string) => new RegExp(`^${prefix}/?$`);

test.describe('Header market switch on a PDP', () => {
  test.skip(({ isMobile }) => isMobile, 'Header dropdown selector is desktop-only');

  // GB ↔ US share the same URL prefix (none), so "lands on home" cannot be verified by URL alone —
  // the theme keeps the shopper on the current page when the prefix does not change. We only cover
  // cross-prefix pairs here; the GB↔US header + currency change is covered by cart-market-sync.
  const countrySwitches: Array<{ from: Country; to: Country }> = [
    { from: 'GB', to: 'DE' },
    { from: 'GB', to: 'SE' },
    { from: 'DE', to: 'GB' },
    { from: 'SE', to: 'DE' },
  ];

  for (const { from, to } of countrySwitches) {
    test(`MKT-031 PDP in ${from} → pick ${to} in the header → home page of ${to}`, async ({ store }) => {
      const source = MARKETS[from];
      const target = MARKETS[to];
      await store.openProduct(GROUPS.blood[source.language], source); // also checks link + header = source

      await store.switchCountryInHeader(to);

      await store.waitForPath(homePath(target.prefix), target); // link + header + Shopify state = target
    });
  }

  const languageSwitches: Array<{ from: Country; to: Language }> = [
    { from: 'GB', to: 'de' },
    { from: 'GB', to: 'sv' },
    { from: 'DE', to: 'en' },
  ];

  for (const { from, to } of languageSwitches) {
    test(`MKT-032 PDP in ${from} → pick language "${to}" in the header → home page of its market`, async ({ store }) => {
      const source = MARKETS[from];
      const target = MARKET_FOR_LANGUAGE[to];
      await store.openProduct(GROUPS.blood[source.language], source);

      await store.switchLanguageInHeader(to);

      await store.waitForPath(homePath(target.prefix), target);
      expect(new URL(store.page.url()).pathname).not.toContain('/products/');
    });
  }
});
