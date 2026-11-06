import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { MARKETS, MARKET_FOR_LANGUAGE, type Language, type Market } from '../../test-data/store';

/**
 * MKT-019 — data check for the `custom.product_groups_per_market` metaobjects (DAO-40).
 * Reads every product's server-rendered `data-language-product-map` and verifies each mapped
 * value is a real handle that opens on its own market.
 *
 * It sends ~100+ requests, which is enough to trip the live store's rate limit (HTTP 429) and
 * break every other test in the run — so it is opt-in (RUN_DATA_CHECK=true), runs once
 * (chromium) and is throttled. Run it on its own:  RUN_DATA_CHECK=true npx playwright test language-map-data --project=chromium
 */

const THROTTLE_MS = 700;
const MAX_429_RETRIES = 3;

async function politeGet(request: APIRequestContext, url: string): Promise<APIResponse> {
  for (let attempt = 0; ; attempt++) {
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    const res = await request.get(url, { maxRedirects: 0 });
    if (res.status() !== 429 || attempt === MAX_429_RETRIES) {
      if (res.status() === 429) throw new Error(`Rate limited (429) at ${url} — try again later`);
      return res;
    }
    const retryAfter = Number(res.headers()['retry-after']) * 1000 || 5000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30_000)));
  }
}

/** Selects the region like the header selector does (POST /localization); the cookie sticks to `request`. */
async function selectMarket(request: APIRequestContext, market: Market) {
  await new Promise((r) => setTimeout(r, THROTTLE_MS));
  const res = await request.post('/localization', {
    form: {
      form_type: 'localization',
      utf8: '✓',
      _method: 'put',
      country_code: market.country,
      locale_code: market.language,
      return_to: market.prefix || '/',
    },
    maxRedirects: 0,
  });
  expect([200, 302, 303], `POST /localization for ${market.country}`).toContain(res.status());
}

test.describe('Language product map data', () => {
  test.skip(process.env.RUN_DATA_CHECK !== 'true', 'Opt-in data crawl — set RUN_DATA_CHECK=true and run it alone');
  test.skip(({ browserName }) => browserName !== 'chromium', 'HTTP-only data check, run once');

  const preview = process.env.PREVIEW_THEME_ID ? `?preview_theme_id=${process.env.PREVIEW_THEME_ID}` : '';

  test('MKT-019 every mapped handle is valid and reachable in its market', async ({ request }) => {
    test.setTimeout(15 * 60_000);

    // 1. Read every product's map from the English (GB) storefront — clean URLs, region picked once.
    await selectMarket(request, MARKETS.GB);
    const res = await politeGet(request, `/products.json?limit=250`);
    expect(res.ok()).toBe(true);
    const { products } = (await res.json()) as { products: Array<{ handle: string }> };

    const problems: string[] = [];
    const targets: Array<{ source: string; language: Language; handle: string }> = [];

    for (const { handle } of products) {
      const page = await politeGet(request, `/products/${handle}${preview}`);
      if (!page.ok()) continue; // product is restricted to another market — its map is checked from the EN side
      const raw = (await page.text()).match(/data-language-product-map='([^']*)'/)?.[1];
      if (!raw) continue;

      const map = JSON.parse(raw) as Record<string, string | boolean>;
      for (const [language, target] of Object.entries(map)) {
        if (language === '__is_product_page__') continue;
        const value = String(target);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
          problems.push(`${handle} → ${language}: "${value}" is not a product handle`);
          continue;
        }
        if (language in MARKET_FOR_LANGUAGE) targets.push({ source: handle, language: language as Language, handle: value });
      }
    }

    // 2. Open every mapped handle in its own market — region switched once per language.
    for (const language of Object.keys(MARKET_FOR_LANGUAGE) as Language[]) {
      const market = MARKET_FOR_LANGUAGE[language];
      const forLanguage = targets.filter((t) => t.language === language);
      if (!forLanguage.length) continue;

      await selectMarket(request, market);
      for (const t of forLanguage) {
        const target = await politeGet(request, `${market.prefix}/products/${t.handle}${preview}`);
        if (target.status() !== 200) {
          problems.push(`${t.source} → ${language}: ${market.prefix}/products/${t.handle} returns ${target.status()} in ${market.country}`);
        }
      }
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
