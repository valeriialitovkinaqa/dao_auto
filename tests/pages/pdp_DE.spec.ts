import { pdpPageSuite } from '../../helpers/pdp-page';
import { MARKETS } from '../../test-data/store';

/**
 * Product page (PDP) — German storefront: DE / de / EUR, links /de/products/….
 * Shared checks: helpers/pdp-page.ts. PDP-011 fails until the membership link keeps /de (finding F-13).
 */

pdpPageSuite(MARKETS.DE);
