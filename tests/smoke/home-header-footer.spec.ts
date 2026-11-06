import { test, expect } from '../../helpers/fixtures';
import { SUPPORT_EMAIL } from '../../test-data/store';

// Full page load (images, fonts, analytics): this file checks that home page images load.
test.use({ loadAssets: true });

/**
 * SMK-001…004 — home page, header (desktop + mobile) and footer.
 * Selectors come from the live markup (header-component, cart-drawer-component, header-drawer, footer).
 */

const MENU = [
  { text: 'Blog', href: '/blogs/news' },
  { text: 'Workbooks', href: '/collections/workbooks' },
  { text: 'Membership', href: '/products/daosense-membership' },
  { text: 'FAQ', href: '/pages/faq' },
  { text: 'Contact', href: '/pages/contact' },
];

/** Footer policies (the "Terms and Policies" list + footer links). "Cancellation policy" → subscription-policy. */
const POLICIES = [
  '/policies/privacy-policy',
  '/policies/subscription-policy',
  '/policies/refund-policy',
  '/policies/contact-information',
  '/policies/shipping-policy',
  '/policies/terms-of-service',
  '/policies/legal-notice',
];

test.describe('Home page', () => {
  test('SMK-001 home page loads completely: 200, images, no failed requests', async ({ page, store }) => {
    const failed: string[] = [];
    page.on('response', (r) => {
      const url = new URL(r.url());
      if (url.host === new URL(page.url() || 'https://www.daosense.org').host && r.status() >= 400) failed.push(`${r.status()} ${url.pathname}`);
    });

    await store.open('/', 'GB');
    await page.waitForLoadState('load');

    await expect(page.locator('main#MainContent')).toBeVisible();
    expect(await page.locator('main .shopify-section').count(), 'home sections rendered').toBeGreaterThan(5);

    // scroll through the page so lazy images load, then check none is broken
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
    });
    const broken = await page.locator('main img').evaluateAll((imgs) =>
      imgs
        .map((i) => i as HTMLImageElement)
        .filter((i) => i.complete && i.currentSrc && i.naturalWidth === 0)
        .map((i) => i.currentSrc)
    );
    expect(broken, 'broken images on the home page').toEqual([]);
    expect(failed, 'same-origin requests with 4xx/5xx').toEqual([]);
  });
});

test.describe('Header — desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop header');

  test.beforeEach(async ({ store }) => {
    await store.open('/', 'GB');
  });

  test('SMK-002 logo leads home and the main menu opens every page', async ({ page, store }) => {
    await expect(store.mainMenuLinks).toHaveText(MENU.map((m) => m.text));
    for (const { text, href } of MENU) {
      await expect(store.mainMenuLinks.filter({ hasText: text })).toHaveAttribute('href', href);
    }

    for (const { text, href } of MENU) {
      await store.mainMenuLinks.filter({ hasText: text }).click();
      await page.waitForURL((u) => u.pathname === href);
      await store.assertNotBlocked();
      await expect(page.locator('main')).toBeVisible();
      await page.locator('a.header-logo').click();
      await page.waitForURL((u) => u.pathname === '/');
    }
  });

  test('SMK-002 search icon opens the search dialog', async ({ store }) => {
    await store.searchButton.click();
    await expect(store.searchModal).toBeVisible();
    await expect(store.predictiveInput).toBeVisible();
  });

  test('SMK-002 account icon opens the account panel (guest: Join + Sign in)', async ({ store }) => {
    await store.accountButton.click();
    await expect(store.accountPopover).toBeVisible();
    await expect(store.accountPopover.locator('a[href*="/products/daosense-membership"]')).toBeVisible();
    await expect(store.accountPopover.locator('a[href*="/account"]')).toBeVisible();
  });

  test('SMK-002 cart icon opens the cart drawer', async ({ store }) => {
    await store.cartDrawerTrigger.click();
    await expect(store.cartDrawer).toBeVisible();
  });
});

test.describe('Header — mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('SMK-003 burger menu opens with all items and closes', async ({ page, store }) => {
    await store.open('/', 'GB');

    await store.mobileMenuToggle.click();
    await expect(page.locator('#Details-menu-drawer-container')).toHaveAttribute('open', '');
    await expect(store.mobileMenuLinks.filter({ visible: true })).toHaveText(MENU.map((m) => m.text));

    await page.locator('button.menu-drawer__close-button').filter({ visible: true }).first().click();
    await expect(page.locator('#Details-menu-drawer-container')).not.toHaveAttribute('open', '');
  });
});

test.describe('Footer', () => {
  test('SMK-004 policies, social links, e-mail and copyright', async ({ page, store }) => {
    await store.open('/', 'GB');

    // every policy is linked from the footer area and opens with content
    for (const path of POLICIES) {
      const link = page.locator(`footer a[href$="${path}"], .footer-utilities a[href$="${path}"], #terms-policies-popover a[href$="${path}"]`);
      expect(await link.count(), `footer links to ${path}`).toBeGreaterThan(0);
    }
    for (const path of POLICIES) {
      const res = await store.gotoPolitely(store.url(path));
      expect(res?.status(), `${path} opens`).toBe(200);
      await expect(page.locator('main'), `${path} has content`).toContainText(/\w{20,}|\w+\s+\w+\s+\w+/);
    }

    await store.open('/', 'GB');
    const instagram = page.locator('footer a[href*="instagram.com/daosense"]');
    expect(await instagram.count(), 'Instagram profiles in the footer').toBeGreaterThan(0);
    await expect(page.locator(`footer a[href="mailto:${SUPPORT_EMAIL}"]`).first()).toBeAttached();
    await expect(page.locator('p', { hasText: '©' }).last()).toContainText(String(new Date().getFullYear()));
  });
});
