# DaoSense — Playwright e2e

End-to-end autotests for the DaoSense storefront (Shopify, Horizon theme). Coverage: market and
language switching, cart sync and locking, CartMax bundles, home page, collection pages (PLP),
product pages (PDP), search, cart and checkout, blog and forms, membership and member pricing,
account area, translations, layout, accessibility and the browser console.

- Test case steps live in `../test-cases/DAO_Sense_Test_Cases.xlsx` (the "Autotest (file:line)" column links to the specs).
- Findings: `../test-cases/Findings.xlsx`; cross-check with the external spec: `../test-cases/DAO_comparison_2026-10-19.xlsx`.
- Autotest backlog: `../BACKLOG.md`.
- Which files have already been reviewed and how they ran last time — see [REVIEW-STATUS.md](REVIEW-STATUS.md).

## Getting started

For a fresh clone — from zero to a first green run:

```bash
git clone git@github.com:valeriialitovkinaqa/dao_auto.git
cd dao_auto

# 1. Install dependencies and browsers
npm install
npx playwright install

# 2. Create a local .env (defaults already point at the live store)
cp .env.example .env

# 3. First run — critical path only, no auth required (~1–2 min)
npm run test:smoke
```

That's it for the guest-facing suite (markets, catalog, cart as a guest, site health).

**What else to know before running the full suite:**

- **Member / customer tests need manual login.** Shopify Customer Accounts log in with a one-time
  code sent by email, so they can't be automated. For member tests:
  1. Put `MEMBER_EMAIL=<test member's email>` in `.env`.
  2. Run `npm run auth:member` — a browser opens on the login page. Enter the email, then paste the
     code from the inbox. The session is saved to `.auth/member.json` (git-ignored) and reused for
     a few weeks. Repeat when it expires.
  3. The same flow exists for a non-member customer: `npm run auth:customer`.

  Without a session file, the matching tests skip themselves with a clear message.

- **The live store rate-limits bursts.** Tests run in **one worker** with a 3-second pause between
  tests (`TEST_PAUSE_MS`) and honor `Retry-After` on HTTP 429. If a run hits Cloudflare's bot check
  (`cf-mitigated: challenge`), the test fails fast with `BotChallengeError` — take a 30–60 min
  break or ask the store owner to allow-list the test IP. Prefer a preview theme (`PREVIEW_THEME_ID`)
  over the published one.

- **Tests never complete checkout.** They add to cart and switch markets, but they stop at the
  checkout URL — nothing is ever paid.

## Install

```bash
npm install
npx playwright install
cp .env.example .env
```

## Run

| Command | What it does |
|---|---|
| `npm test` | all projects: chromium, firefox, webkit, mobile-safari |
| `npx playwright test --project=chromium` | one browser |
| `npm run test:smoke` | critical path — tests tagged `@smoke` |
| `npm run test:market` | `tests/market` (markets, language, cart, bundles, popup) |
| `npm run test:membership` | pricing from the guest's point of view + member tests |
| `npm run test:member` | member tests only, chromium |
| `npm run test:batched` | batched run with pauses — custom arguments, see below |
| `npm run test:pdp:batched` | PDP across 4 markets, 3 loops, with pauses |
| `npm run test:headed` | chromium with a visible window |
| `npm run list` | list tests without running them |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run report` | open the HTML report |
| `npm run auth:member`, `npm run auth:customer` | one-off manual login (see "Sessions") |

### Batched run (`scripts/run-batched.mjs`)

The live store rate-limits requests, so long runs are better split into batches with long pauses.
The script does not bypass protection: if it hits Cloudflare or 429, it waits and retries the batch
**once**, then stops.

```bash
node scripts/run-batched.mjs --repeat 3 tests/pages/pdp_DE.spec.ts "tests/pages/pdp.spec.ts::GB / en"
node scripts/run-batched.mjs --dry tests/pages/pdp_SV.spec.ts     # list tests only, no requests to the store
```

A batch is a spec file, optionally with a test-name filter after `::`.
Options: `--repeat N` (loops, default 1), `--gap MIN` (pause between batches, 10),
`--challenge-wait M` (pause after Cloudflare before the retry, 45), `--project NAME` (chromium),
`--pause MS` (`TEST_PAUSE_MS`, 3000), `--dry`.

Output of one run (both folders are git-ignored):

```
playwright-report/batches/<date_time>/<batch>-r<loop>.log   # batch log
playwright-report/batches/<date_time>/<batch>-r<loop>/      # batch HTML report
playwright-report/batches/<date_time>/summary.md            # table: passed / failed / challenge
test-results/batches/<date_time>/<batch>-r<loop>/           # traces, screenshots, video
```

## Environment (`.env`)

| Variable | Purpose |
|---|---|
| `BASE_URL` | Storefront URL. Defaults to `https://www.daosense.org` |
| `PREVIEW_THEME_ID` | ID of an unpublished theme — appended as `preview_theme_id` to every navigation |
| `STOREFRONT_PASSWORD` | Storefront password, if the password page is enabled |
| `TEST_PAUSE_MS` | Pause after every test, ms (default 3000). Raise to 5000–10000 if you often hit 429. `0` disables it |
| `MARKET_POPUP_ENABLED` | `true` if the theme has the region popup turned on (otherwise popup tests are skipped) |
| `RUN_DATA_CHECK` | `true` — enable the MKT-019 catalog crawl (run it separately) |
| `RUN_CHECKOUT` | `true` — CART-006 opens Shopify checkout on 4 markets (never pays) |
| `PROMO_CODE` | A valid discount code. Without it CART-003 only checks the invalid-code path |
| `MEMBER_EMAIL` | Test member's email — needed for ACC-002 |

`MEMBER_LOGIN` and `CUSTOMER_LOGIN` are set by the `auth:member` / `auth:customer` scripts themselves,
you don't need to set them by hand.

> The live store rate-limits requests: on a burst it answers **HTTP 429** and shows the "Your
> connection needs to be verified" check. That's why tests run in **1 worker**, pause between tests
> (`TEST_PAUSE_MS`), and retry page opens and requests on 429 (waiting for `Retry-After` or 3 → 6 →
> 12 s). If the limit does not clear, they fail with `RateLimitError`. Wait a few minutes and run
> again (one file at a time or through the batched run).
>
> If Cloudflare triggers the **bot check** (response with `cf-mitigated: challenge`), the test fails
> immediately with `BotChallengeError` — retries and pauses do not help, and the check must not be
> bypassed. Take a 30–60 minute break, or ask the store owner to allow-list the test IP, or run
> against a dev/preview store.
>
> Tests add products to the cart and switch markets, but **never complete payment**.
> Prefer a preview theme (`PREVIEW_THEME_ID`) over the published one.

## Layout

```
helpers/fixtures.ts                 # test with a `store` fixture + options loadAssets / marketPopupSeen / closeNewsletterPopup
helpers/storefront.ts               # Page Object: region picker, clean URLs (/de|/sv), cart API, locators
helpers/pdp-page.ts                 # shared PDP checks (PDP-001…013), one run per market; @smoke tag lives here
helpers/collection-page.ts          # shared PLP checks (PLP-001…016), one run per market
helpers/auth.ts                     # paths to .auth/*.json and session presence check
helpers/money.ts                    # parseMoney, memberPriceOf
test-data/store.ts                  # markets, product language groups, collections, notice texts
scripts/run-batched.mjs             # batched runs with pauses

tests/auth/member.setup.ts          # manual member login → .auth/member.json
tests/auth/customer.setup.ts        # manual non-member login → .auth/customer.json
tests/market/                       # MKT-*: markets, language, cart sync and lock, CartMax bundles, popup
tests/pages/                        # home page, collections ×3 (GB+US, DE, SV), PDP ×3 (GB+US, DE, SV)
tests/smoke/                        # SMK-*, CART-*: home/header/footer, search, cart and checkout, blog, forms, 404
tests/account/                      # MEM-*, ACC-*: guest, non-member customer, member
tests/ui_extra/                     # TRN-*, LAY-*, A11Y-*, CON-*: translations, layout, keyboard, contrast, console
```

Which files have been reviewed step by step and how they ran last — see
[REVIEW-STATUS.md](REVIEW-STATUS.md). Until 04.11.2026 that information was carried in a `CHECKED_`
prefix in file names; the prefix is gone (BL-05) and the status moved into its own file.

## Fixtures and options (`helpers/fixtures.ts`)

| Option | Default | What it does |
|---|---|---|
| `loadAssets` | `false` | Images, video, fonts and analytics are **blocked**: on the storefront that is ~90% of the requests, and skipping them makes 429 much less likely. Enable per file: `test.use({ loadAssets: true })` |
| `marketPopupSeen` | `true` | Sets `localStorage.market_selected` so the first-visit popup never gets in the way |
| `closeNewsletterPopup` | `true` | Auto-closes the subscribe popup (Shopify Forms) the way a shopper would |

A separate `consoleErrors` fixture collects `pageerror` and `console.error` **from the storefront
domain only** — pixels and third-party apps (Pinterest, Google, Shop Pay) are ignored.

Files where images are loaded in full: `tests/pages/homepage.spec.ts`,
`tests/smoke/home-header-footer.spec.ts`, `tests/smoke/content-forms.spec.ts`,
`tests/ui_extra/a11y-console.spec.ts`, `tests/ui_extra/translations-layout.spec.ts`.
Partial enablement — PDP-003 (gallery) and PLP-006 (card images).

## Test case IDs

On 21.10.2026 the `TC-` prefix was dropped from IDs. The current prefixes mirror the tabs in
`DAO_Sense_Test_Cases.xlsx`:

| Prefix | Tab | About |
|---|---|---|
| `MKT` | Lang+Market | markets, language, cart sync |
| `MEM` | Membership | membership and member pricing |
| `ACC` | Account | account area |
| `SMK` | Smoke | base storefront checks |
| `CART` | Cart | cart and checkout |
| `PLP` | PLP | collection page |
| `PDP` | PDP | product page |
| `TRN` | Translations | translations |
| `LAY` | Layout | layout |
| `A11Y` | a11y | accessibility |
| `CON` | Console | console errors |

Decoding and mapping to old IDs — on the Legend tab; external E-cases — in
`DAO_comparison_2026-10-19.xlsx`. `F-xx` in test comments — findings from `Findings.xlsx`,
`R-xx` — risks.

## Sessions: member and non-member customer

Storefront login uses a one-time email code, so it is done **manually, once**.

**Member** (`tests/account/active-member.spec.ts`) — needs an account tagged `active_subscription`:

1. In `.env`, set `MEMBER_EMAIL=<member's email>`.
2. Run `npm run auth:member` — a browser opens on the login page.
3. Enter the email and the code from the inbox. When the account area loads, the session is saved
   to `.auth/member.json` (git-ignored).
4. Run `npm run test:member`. If the session expired, repeat step 2.

**Non-member customer** (`tests/account/customer.spec.ts`) — same flow: run `npm run auth:customer`
once, log in with an account **without** the `active_subscription` tag (session → `.auth/customer.json`).

Without the session file the matching tests are skipped. The member's cart is attached to the
account — tests clear it before and after; they never enter checkout, never touch the subscription,
and never log out.

## What stays manual

MKT-029, MEM-006, ACC-004, ACC-010…012, ACC-015, SMK-024, SMK-025, SMK-031, SMK-035 — these need
special accounts/data, a Theme Editor change, an email code, a form submission with hCaptcha or the
storefront password.

## Member pricing — what is checked

| Product | Guest | Member |
|---|---|---|
| "Free for members" (`foundations` and equivalents) | normal main price; "💡 Member price: Free", "Regular price", "Buy now membership…" link | main price "Free" + strikethrough; "💎 Member price: Free"; 0 in the cart |
| Normal (`september-from-digestion-to-clarity` and equivalents) | normal main price; "💡 Member price: <price × 0.67>", "Regular price", link | normal main price; "💎 Member price: <price × 0.67>", "Regular price"; cart line = Member price |
| Membership `daosense-membership` | normal price, no Member price block | same; a member can buy the membership again (expected) |

The rate — `MEMBER_PRICE_RATE = 0.67` in `test-data/store.ts`.

## How the market is switched

Each language product is restricted to its own market: DE/de/EUR, SE/sv/SEK, GB/en/GBP, US/en/USD.
Links in tests look exactly like shopper links: `https://www.daosense.org/sv/products/mjalten-i-centrum` —
no `?country=`. The market is picked the same way as in the header "Region and language" selector:
`store.open(path, 'SE')` first submits the `POST /localization` form (country + language), Shopify
stores the region in the `localization` cookie, and then the clean `/sv{path}` link is opened. If
the region is already selected, the form is not resubmitted. Without picking the region, Shopify
decides the market by IP, and products of other markets answer 404.

**Market check before actions.** After every `store.open(path, market)` and after every redirect
triggered by a language switch (`store.waitForPath(path, market)`), the test first verifies that
the page actually opened in the expected market, and only then clicks or changes anything:
1. link — language prefix in the URL (`/de`, `/sv`, no prefix for English);
2. header — the "Region and language" selector has the right country picked (`li[aria-current="true"]`) and its currency is shown;
3. Shopify state — `window.Shopify.locale / country / currency`.

**Rule for market switch on the PDP.** If you change country or language on a product page from
the header, the store sends the shopper to the **home of the picked market** (`/de`, `/sv`, `/`) —
this is the expected behavior (MKT-031/032, `header-market-switch.spec.ts`). Switching the language
via the selector on the PDP itself + "Add to cart" is a different scenario: there an equivalent
product opens (MKT-010…).

This catches, for example, a case where `https://www.daosense.org/` opened but the header still
has Sweden (SEK) picked. The error message says which part didn't match.
The cart is read via `/cart.js` from inside the page, so cookies and market match the browser.

## Tests that are skipped

| Test | When skipped |
|---|---|
| MKT-015 | `fixme` — expected behavior for US + en is not confirmed (code redirects to GB, risk R-05) |
| MKT-001…005, A11Y-005, TRN-004 (popup) | without `MARKET_POPUP_ENABLED=true` — popup is off in the theme. MKT-008 always runs: it verifies the popup is absent when it should be |
| MKT-017 | without `PREVIEW_THEME_ID` — only checks a preview theme |
| MKT-019 | without `RUN_DATA_CHECK=true`; chromium only — catalog crawl (~100+ requests), run separately |
| CART-006 | without `RUN_CHECKOUT=true` — opens Shopify checkout |
| CART-001 | if the cart has no quantity stepper (`quantity-selector` is commented out in `snippets/cart-products.liquid`) |
| CART-004 | if the cart has no order note field |
| MEM-003…005, MEM-008, MEM-010, ACC-001…008, ACC-018/019, TRN-005 | without `.auth/member.json` — run `npm run auth:member` first |
| MEM-007, ACC-009, ACC-013 | without `.auth/customer.json` — run `npm run auth:customer` first |
| ACC-002 | without `MEMBER_EMAIL` in `.env` |
| ACC-003 | if the member has no orders — "Member since" is not rendered (ACC-004) |
| SMK-002, SMK-022, ACC-017, MKT-031/032, TRN-001 (header), A11Y-001/002 | on the mobile-safari project — desktop header, search and keyboard |

## Tests that are expected to fail

These are storefront defects, not test bugs.

| Test | Finding / risk |
|---|---|
| PDP-011 on `/de` and `/sv` | F-13 — "Buy now membership…" link drops the language prefix |
| PLP-015 on US, DE, SE | F-23 — the "Price" facet is only rendered on GB |
| PLP-008 on DE and SE | F-25 (price sort); soft check — one run reports every broken option at once |
| TRN-005 on DE and SE | R-12 — "Hello" and "Workbooks" are hard-coded in English in `users-section.liquid` |
| MKT-030 | R-07 — on a failed add the old line is already removed, the product is lost |
| MKT-026, re-add step | R-08 — re-add link without the language prefix |

An earlier version of this README also listed contrast (A11Y-004) and footer/layout (LAY-*, risks
R-15 and R-17) among the expected failures. The code of those tests has no known-fail annotation —
confirm the status on the next run. (F-24 — German title of `lunge-dickdarm` — is marked `Fixed` in
Findings after a 06.11.2026 verification.)

## Test data

Product handles and language groups were pulled from live on 16.10.2026
(`data-language-product-map` on the PDP and `/products.json`). When the catalog changes, update
`test-data/store.ts`. Reference groups: `blood`, `foundations`, `september`, `october2025`;
product with no language equivalents — `january-2026`; membership — `daosense-membership` (same
handle on every market). The source of truth for theme settings is the `live` branch
(`config/settings_data.json`), `develop` may lag behind.
