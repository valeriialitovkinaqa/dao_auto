import fs from 'node:fs';
import path from 'node:path';

/** Saved session of the test member (created by `npm run auth:member`). Git-ignored. */
export const MEMBER_STORAGE_STATE = path.join(__dirname, '..', '.auth', 'member.json');

export const hasMemberSession = (): boolean => fs.existsSync(MEMBER_STORAGE_STATE);

/** Email of the test member, used to check the profile blocks (set MEMBER_EMAIL in .env). */
export const MEMBER_EMAIL = process.env.MEMBER_EMAIL || '';

/** Saved session of a logged-in customer WITHOUT the active_subscription tag (`npm run auth:customer`). */
export const CUSTOMER_STORAGE_STATE = path.join(__dirname, '..', '.auth', 'customer.json');

export const hasCustomerSession = (): boolean => fs.existsSync(CUSTOMER_STORAGE_STATE);
