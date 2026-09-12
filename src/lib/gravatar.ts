/**
 * Gravatar integration — generate avatar URLs from email addresses.
 *
 * Standard Gravatar flow:
 *   1. Normalize email (trim + lowercase).
 *   2. MD5 hash the normalized email.
 *   3. Build URL: https://www.gravatar.com/avatar/<hash>?s=<size>&d=<default>
 *
 * The 'd' (default) parameter controls what Gravatar returns when the user
 * has no Gravatar account — we use 'identicon' (a generated geometric pattern
 * unique to the email hash) as the fallback so every author gets a distinct
 * visual identity, even without a configured Gravatar.
 *
 * MD5 is computed via the `js-md5` npm package (pure-JS, no native deps).
 */

import { md5 } from 'js-md5';

export const GRAVATAR_BASE = 'https://www.gravatar.com/avatar/';

/**
 * Build a Gravatar avatar URL for the given email.
 *
 * @param email  Commit author email (any case — will be lowercased).
 * @param size   Avatar size in pixels (default 24).
 * @returns      Gravatar URL with identicon fallback.
 *               Returns '' if email is empty.
 */
export function gravatarUrl(email: string | undefined, size = 24): string {
  if (!email) return '';
  const normalized = email.trim().toLowerCase();
  if (!normalized) return '';
  const hash = md5(normalized);
  return `${GRAVATAR_BASE}${hash}?s=${size}&d=identicon&r=g`;
}

/**
 * Decide whether a given email is likely to have a real Gravatar account.
 * Conservative: only obvious patterns like 'user@github.com' (GitHub
 * generates default avatars via Gravatar) and 'noreply@github.com'.
 *
 * Used by the Avatar component to decide whether to lazy-load the
 * Gravatar image (network request) or just render the colored-initial
 * fallback synchronously.
 */
export function likelyHasGravatar(email: string | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.endsWith('@github.com')) return true;
  if (e.endsWith('@users.noreply.github.com')) return true;
  if (e.endsWith('@gitlab.com')) return true;
  return false;
}
