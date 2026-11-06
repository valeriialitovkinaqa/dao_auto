import { test, expect } from '../../helpers/fixtures';
import { MEMBERSHIP_PRODUCT } from '../../test-data/store';

// Full page load (images, fonts, analytics): this file checks article images and the newsletter form.
test.use({ loadAssets: true });

/**
 * SMK-026…034 — blog, article, membership page sections, contact & newsletter forms (client-side only),
 * thank-you and 404 pages. Forms are never submitted: the store sends e-mails and uses hCaptcha.
 */

test.describe('Blog', () => {
  test('SMK-026 blog lists articles with image, title and date', async ({ page, store }) => {
    await store.open('/blogs/news', 'GB');
    const cards = page.locator('div.blog-post-item');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of (await cards.all()).slice(0, 4)) {
      await expect(card.locator('img').first()).toBeAttached();
      await expect(card.locator('.blog-post-card__content a').first()).toHaveText(/\S/);
      await expect(card.locator('time[datetime]').first()).toBeAttached();
    }
    const lastPage = Number(await page.locator('.blog-posts-container').getAttribute('data-last-page')) || 1;
    test.info().annotations.push({ type: 'note', description: `blog pages: ${lastPage}` });
    if (lastPage > 1) {
      const first = await cards.first().locator('.blog-post-card__content a').first().getAttribute('href');
      await store.open('/blogs/news', 'GB', { page: '2' });
      expect(await page.locator('div.blog-post-item').count(), 'page 2 has articles').toBeGreaterThan(0);
      expect(await page.locator('div.blog-post-item .blog-post-card__content a').first().getAttribute('href')).not.toBe(first);
    }
  });

  test('SMK-027 article: narrow centred column, images load, "Back" leads to the blog', async ({ page, store }) => {
    await store.open('/blogs/news/menopause-in-chinese-medicine', 'GB');
    const content = page.locator('.blog-post-content').first();
    await expect(content).toBeVisible();
    const { contentWidth, viewport } = await content.evaluate((el) => ({ contentWidth: el.getBoundingClientRect().width, viewport: window.innerWidth }));
    expect(contentWidth, 'content column is narrower than the viewport').toBeLessThan(viewport);

    const broken = await page.locator('main img').evaluateAll((imgs) =>
      imgs.map((i) => i as HTMLImageElement).filter((i) => i.complete && i.currentSrc && i.naturalWidth === 0).map((i) => i.currentSrc)
    );
    expect(broken, 'broken images in the article').toEqual([]);

    await page.locator('a.back-button').filter({ visible: true }).first().click();
    await page.waitForURL((u) => u.pathname === '/blogs/news');
  });
});

test.describe('Membership page', () => {
  test('SMK-028 membership page renders its sections', async ({ page, store }) => {
    await store.openProduct(MEMBERSHIP_PRODUCT, 'GB');
    for (const heading of ["What's Included", 'Meet the DaoSense Team', 'Your questions, answered']) {
      await expect(page.getByRole('heading', { name: heading }).first(), heading).toBeVisible();
    }
    for (const benefit of ['Monthly Workbook', 'Monthly Qi Gong Practice', 'In-Depth Article', 'Member Pricing in the Shop']) {
      await expect(page.getByRole('heading', { name: benefit }).first(), benefit).toBeAttached();
    }
  });
});

test.describe('Forms (validated in the browser, never submitted)', () => {
  test('SMK-029 contact form marks the required fields', async ({ page, store }) => {
    await store.open('/pages/contact', 'GB');
    const email = page.locator('form.contact-form__form input[name="contact[email]"]').first();
    await expect(email).toBeAttached();
    const required = await email.evaluate((el) => (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true');
    expect(required, 'e-mail is marked as required').toBe(true);

    const body = page.locator('form.contact-form__form textarea[name="contact[body]"]').first();
    const bodyRequired = await body.evaluate((el) => (el as HTMLTextAreaElement).required);
    if (!bodyRequired) {
      test.info().annotations.push({
        type: 'finding',
        description: 'Contact fields have no `required` attribute — an empty form is only rejected server-side (not submitted by the test because of hCaptcha).',
      });
    }
  });

  test('SMK-030 contact form rejects an invalid e-mail before sending', async ({ page, store }) => {
    await store.open('/pages/contact', 'GB');
    const email = page.locator('form.contact-form__form input[name="contact[email]"]').first();
    for (const value of ['test@', 'test.com', 'a b@c.d']) {
      await email.fill(value);
      expect(await email.evaluate((el) => (el as HTMLInputElement).checkValidity()), `"${value}" is invalid`).toBe(false);
    }
    await email.fill('qa.test@example.com');
    expect(await email.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(true);
  });

  test.describe('newsletter', () => {
    test.use({ closeNewsletterPopup: false });

    test('SMK-032 "SUBSCRIBE" opens the newsletter dialog with an e-mail field that rejects an invalid address', async ({ page, store }) => {
      await store.open('/', 'GB');
      const dialog = page.locator('shopify-forms-embed').getByRole('dialog').first();
      const close = page.locator('shopify-forms-embed').getByRole('button', { name: /close/i }).first();

      // the dialog may also pop up by itself after a few seconds — close it first
      const popped = await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
      if (popped) await close.click();

      await page.locator('a.open_newslatter').filter({ visible: true }).first().click();
      await expect(dialog).toBeVisible();

      const email = dialog.getByRole('textbox').first();
      await expect(email).toBeVisible();
      await email.fill('abc');
      expect(await email.evaluate((el) => (el as HTMLInputElement).checkValidity()), '"abc" is invalid').toBe(false);
      await close.click();
      await expect(dialog).toBeHidden();
    });
  });
});

test.describe('Service pages', () => {
  test('SMK-033 thank-you page opens', async ({ page, store }) => {
    const res = await store.gotoPolitely(store.url('/pages/thank-you', 'GB'));
    expect(res?.status()).toBe(200);
    await expect(page.locator('main')).toContainText(/\w+/);
  });

  for (const path of ['/xyz-not-found', '/products/not-existing-product']) {
    test(`SMK-034 ${path} returns a styled 404 with a way back`, async ({ page, store }) => {
      await store.open('/', 'GB');
      const res = await store.gotoPolitely(store.url(path, 'GB'));
      expect(res?.status()).toBe(404);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('main a[href$="/collections/all"]').first(), '"Continue shopping" link').toBeVisible();
      await expect(page.locator('a.header-logo')).toHaveAttribute('href', '/');
    });
  }

  test('SMK-034 /de/xyz-not-found shows the 404 in German', async ({ page, store }) => {
    await store.open('/', 'DE');
    const res = await store.gotoPolitely(store.url('/xyz-not-found', 'DE'));
    expect(res?.status()).toBe(404);
    expect(await page.locator('html').getAttribute('lang')).toBe('de');
  });
});
