import { collectionPageSuite } from '../../helpers/collection-page';
import { MARKETS } from '../../test-data/store';

/**
 * Collection page (PLP) — English storefront: GB (GBP) and US (USD).
 * Both markets share the links (/collections/…, /products/…); only the currency differs.
 * Shared checks: helpers/collection-page.ts. German: collections_DE.spec.ts, Swedish: collections_SV.spec.ts.
 * US: PLP-015 fails until the "Price" filter is shown in USD (finding F-23).
 */

collectionPageSuite(MARKETS.GB);
collectionPageSuite(MARKETS.US);
