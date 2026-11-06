import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { MEMBER_STORAGE_STATE } from '../../helpers/auth';

/**
 * One-off, MANUAL login of the test member (new Shopify customer accounts log in with a one-time
 * code sent by email, so it cannot — and should not — be automated).
 *
 *   npm run auth:member
 *
 * A browser window opens on the login page: enter the member's email, then the code from the
 * inbox. As soon as the members area shows the member profile, the session is saved to
 * .auth/member.json (git-ignored — it contains session cookies) and reused by
 * tests/account/active-member.spec.ts. Repeat when the session expires.
 */
setup('log in as the active member (manual)', async ({ page }) => {
  setup.skip(process.env.MEMBER_LOGIN !== 'true', 'Run via `npm run auth:member`');
  setup.setTimeout(10 * 60_000);

  await page.goto('/account');
  console.log('\n👉 Log in as the test member in the opened browser (email + code from the inbox).\n');

  // Wait until the login flow has returned to the customer account (shopify.com/<shop-id>/account/...).
  await page.waitForURL((url) => /^\/\d+\/account\/[a-z]/.test(url.pathname) && !/login/.test(url.pathname), {
    timeout: 9 * 60_000,
  });

  // Confirm the storefront session sees an active member before saving it.
  await page.goto('/pages/members-area');
  await expect(
    page.locator('.custom_account_actions .account-actions__main-menu'),
    'members area should show the member profile — is the account tagged active_subscription?'
  ).toBeVisible({ timeout: 30_000 });

  fs.mkdirSync(path.dirname(MEMBER_STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: MEMBER_STORAGE_STATE });
  console.log(`✅ Member session saved to ${MEMBER_STORAGE_STATE}`);
});
