import { collectionPageSuite } from '../../helpers/collection-page';
import { MARKETS } from '../../test-data/store';

/**
 * Collection page (PLP) — German storefront: DE / de / EUR, links /de/collections/…, /de/products/….
 * Shared checks: helpers/collection-page.ts. PLP-015 fails until the "Price" filter is shown here (finding F-23).
 */

collectionPageSuite(MARKETS.DE);
