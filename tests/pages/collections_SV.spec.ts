import { collectionPageSuite } from '../../helpers/collection-page';
import { MARKETS } from '../../test-data/store';

/**
 * Collection page (PLP) — Swedish storefront: SE / sv / SEK, links /sv/collections/…, /sv/products/….
 * Shared checks: helpers/collection-page.ts. PLP-015 fails until the "Price" filter is shown here (finding F-23).
 */

collectionPageSuite(MARKETS.SE);
