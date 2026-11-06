/**
 * Test data for the DaoSense storefront.
 * Handles and language groups were taken from the live store on 2026-10-16
 * (`data-language-product-map` on each PDP and `/products.json`). Re-check them when the catalog changes.
 */

export type Language = 'en' | 'de' | 'sv';
export type Country = 'GB' | 'US' | 'DE' | 'SE';

export interface Market {
  country: Country;
  language: Language;
  currency: 'GBP' | 'USD' | 'EUR' | 'SEK';
  /** Storefront path prefix for the language ('' for the primary language). */
  prefix: '' | '/de' | '/sv';
}

export const MARKETS: Record<Country, Market> = {
  GB: { country: 'GB', language: 'en', currency: 'GBP', prefix: '' },
  US: { country: 'US', language: 'en', currency: 'USD', prefix: '' },
  DE: { country: 'DE', language: 'de', currency: 'EUR', prefix: '/de' },
  SE: { country: 'SE', language: 'sv', currency: 'SEK', prefix: '/sv' },
};

/** Market each language's product is restricted to (settings.language_market_pairs, first match). */
export const MARKET_FOR_LANGUAGE: Record<Language, Market> = {
  en: MARKETS.GB,
  de: MARKETS.DE,
  sv: MARKETS.SE,
};

export type LanguageGroup = Record<Language, string>;

/** How each market's currency is written on the storefront (money format). */
/**
 * What a price must contain on the page, per market.
 *
 * The theme prints line prices with the `money` filter and totals with `money_with_currency`,
 * so the same amount appears in two forms. For £, $ and € the second form only appends the code
 * (`£30.00` → `£30.00 GBP`) and the symbol is still there, but the Swedish krona has no symbol in
 * that form at all (`90,00 kr` → `180,00 SEK`). Checked on the live cart 05.11.2026 — intended
 * formatting, not a defect, so SEK accepts both spellings.
 */
export const CURRENCY_SYMBOL: Record<Market['currency'], RegExp> = {
  GBP: /£/,
  USD: /\$/,
  EUR: /€/,
  SEK: /kr|SEK/,
};

/**
 * Products linked through the `custom.product_groups_per_market` metaobject.
 * Each language version is a separate product restricted to its own market, e.g.
 *   https://www.daosense.org/products/understand-and-strengthen-blood-copy
 *   https://www.daosense.org/de/products/das-feuerelement
 *   https://www.daosense.org/sv/products/eldelementet
 */
export const GROUPS = {
  /** Reference PDP example (confirmed by the team, 2026-10-19) — handles differ per language by design. */
  blood: {
    en: 'understand-and-strengthen-blood-copy',
    de: 'das-feuerelement',
    sv: 'eldelementet',
  },
  /** Also the "free for members" products (settings.free_for_members_products). */
  foundations: {
    en: 'foundations',
    de: 'grundlagen-der-chinesischen-medizin',
    sv: 'introduktion-till-kinesisk-medicin',
  },
  /** Regular (not free) product — members see "Member price" = 67% of the price. */
  september: {
    en: 'september-from-digestion-to-clarity',
    de: 'die-milz-im-mittelpunkt',
    sv: 'mjalten-i-centrum',
  },
  october2025: {
    en: 'october-2025',
    de: 'zuruck-zur-erde',
    sv: 'att-vila-i-jorden',
  },
} satisfies Record<string, LanguageGroup>;

/** English product with no language equivalents mapped — exercises the fallback / remove paths. */
export const UNMAPPED_EN_PRODUCT = 'january-2026';

/**
 * The membership is ONE product with the same handle in every market:
 *   https://www.daosense.org/products/daosense-membership
 *   https://www.daosense.org/de/products/daosense-membership
 *   https://www.daosense.org/sv/products/daosense-membership
 */
export const MEMBERSHIP_PRODUCT = 'daosense-membership';

/**
 * Collections. `workbooks` exists in every market; on the English storefront /collections/all
 * shows the same products as /collections/workbooks.
 *   https://www.daosense.org/collections/workbooks  (= /collections/all)
 *   https://www.daosense.org/de/collections/workbooks
 *   https://www.daosense.org/sv/collections/workbooks
 */
export const COLLECTIONS = {
  workbooks: 'workbooks',
  /** English-only alias of `workbooks`. */
  allEn: 'all',
} as const;

/** All four markets the store sells in. */
export const ALL_MARKETS: Market[] = [MARKETS.GB, MARKETS.US, MARKETS.DE, MARKETS.SE];

export const FREE_FOR_MEMBERS: Array<{ handle: string; market: Market }> = [
  { handle: GROUPS.foundations.en, market: MARKETS.GB },
  { handle: GROUPS.foundations.de, market: MARKETS.DE },
  { handle: GROUPS.foundations.sv, market: MARKETS.SE },
];

/**
 * "Member price" block on the PDP (custom-liquid block in templates/product.json, class .member-price-note).
 * Shown to everyone except on the membership product:
 *   free-for-members product → "Member price: Free"
 *   any other product        → "Member price: <price × 0.67, rounded>" + "Regular price: <price>"
 * Guests also get the link "Buy now membership and unlock member price" → /products/daosense-membership.
 */
export const MEMBER_PRICE_RATE = 0.67;

/** Products that are NOT free for members — one per market. */
export const MEMBER_DISCOUNTED: Array<{ handle: string; market: Market }> = [
  { handle: GROUPS.september.en, market: MARKETS.GB },
  { handle: GROUPS.september.de, market: MARKETS.DE },
  { handle: GROUPS.september.sv, market: MARKETS.SE },
];

/**
 * Support e-mail in the members area (theme setting `support_content`).
 * Source of truth is the `live` branch (config/settings_data.json) — `develop` may lag behind admin edits.
 */
export const SUPPORT_EMAIL = 'mail@daosense.org';

/** Storefront notice strings, per locale (locales/en.default.json, de.json, sv.json → content.*). */
export const TEXT = {
  langUnavailable: {
    en: /isn.t available in that language yet/i,
    de: /in dieser Sprache noch nicht verfügbar/i,
    sv: /inte tillgänglig på det språket ännu/i,
  },
  itemSwitched: {
    en: /Switched .+ to the version for this market/i,
    de: /auf die Version für diesen Markt umgestellt/i,
    sv: /till versionen för denna marknad/i,
  },
  itemsSwitched: (count: number) => ({
    en: new RegExp(`Switched ${count} items to the version for this market`, 'i'),
    de: new RegExp(`${count} Artikel auf die Version für diesen Markt umgestellt`, 'i'),
    sv: new RegExp(`Bytte ${count} artiklar till versionen för denna marknad`, 'i'),
  }),
  itemRemoved: {
    en: /not available in this market/i,
    de: /in diesem Markt nicht verfügbar/i,
    sv: /inte tillgänglig på denna marknad/i,
  },
  bundleRemoved: {
    en: /Your bundle was removed from the cart/i,
    de: /Ihr Bundle wurde aus dem Warenkorb entfernt/i,
    sv: /Ditt paket togs bort från varukorgen/i,
  },
  /** content.price_free */
  free: /^\s*(Free|Kostenlos|Gratis)\s*$/i,
} satisfies Record<string, unknown>;
