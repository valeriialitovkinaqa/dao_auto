import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CUSTOMER_STORAGE_STATE } from '../../helpers/auth';

/**
 * One-off MANUAL login of a regular customer (NO active_subscription tag):  npm run auth:customer
 * Log in in the opened browser with the e-mail + code from the inbox. The session is saved to
 * .auth/customer.json (git-ignored) and used by tests/account/customer.spec.ts.
 */
setup('log in as a customer without membership (manual)', async ({ page }) => {
  setup.skip(process.env.CUSTOMER_LOGIN !== 'true', 'Run via `npm run auth:customer`');
  setup.setTimeout(10 * 60_000);

  await page.goto('/account');
  console.log('\n👉 Log in as the NON-member test customer in the opened browser (email + code from the inbox).\n');
  await page.waitForURL((url) => /^\/\d+\/account\/[a-z]/.test(url.pathname) && !/login/.test(url.pathname), {
    timeout: 9 * 60_000,
  });

  await page.goto('/pages/members-area');
  await expect(page.locator('h1.main_heading'), 'logged-in greeting should be shown').toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.custom_account_actions .account-actions__main-menu'),
    'this account must NOT be a member (no active_subscription tag)'
  ).toHaveCount(0);

  fs.mkdirSync(path.dirname(CUSTOMER_STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: CUSTOMER_STORAGE_STATE });
  console.log(`✅ Customer session saved to ${CUSTOMER_STORAGE_STATE}`);
});
