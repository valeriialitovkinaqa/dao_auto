import { pdpPageSuite } from '../../helpers/pdp-page';
import { MARKETS } from '../../test-data/store';

/**
 * Product page (PDP) — Swedish storefront: SE / sv / SEK, links /sv/products/….
 * Shared checks: helpers/pdp-page.ts. PDP-011 fails until the membership link keeps /sv (finding F-13).
 */

pdpPageSuite(MARKETS.SE);
