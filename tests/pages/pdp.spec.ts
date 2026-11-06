import { pdpPageSuite } from '../../helpers/pdp-page';
import { MARKETS } from '../../test-data/store';

/**
 * Product page (PDP) — English storefront: GB (GBP) and US (USD).
 * Both markets share the links (/products/…); only the currency differs.
 * Shared checks: helpers/pdp-page.ts. German: pdp_DE.spec.ts, Swedish: pdp_SV.spec.ts.
 * Former smoke tests SMK-011, 013, 014, 015 live here now (PDP-001, 008, 012, 013).
 */

pdpPageSuite(MARKETS.GB);
pdpPageSuite(MARKETS.US);
