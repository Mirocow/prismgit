/**
 * Gravatar integration — generate avatar URLs from email addresses.
 *
 * Gravatar accepts MD5 OR SHA-256 hashes since 2020. We use SHA-256 via
 * the Web Crypto API (`crypto.subtle.digest`) — no npm dependency, no
 * pure-JS MD5 implementation to maintain, available in all modern
 * browsers, Electron, and Tauri renderer.
 *
 * Standard Gravatar flow:
 *   1. Normalize email (trim + lowercase).
 *   2. SHA-256 hash the normalized email.
 *   3. Build URL: https://www.gravatar.com/avatar/<hex>?s=<size>&d=<default>
 *
 * Synchronous MD5 fallback (for callers that can't await): a small
 * inlined pure-JS implementation. Gravatar's primary recommendation
 * is MD5 (they've been hashing emails with MD5 since 2003); we use
 * SHA-256 by default but expose `gravatarUrlMd5Sync` for cases where
 * the URL must be computed synchronously (initial render, memoized
 * hooks).
 */

export const GRAVATAR_BASE = 'https://www.gravatar.com/avatar/';

/**
 * Sync MD5 — inlined pure-JS implementation (no npm dep).
 * Public-domain algorithm adapted from Joseph Myers' code.
 */
function md5cycle(x: number[], k: number[]): void {
  let [a, b, c, d] = x;
  function cmn(q: number, _a: number, _b: number, _x: number, s: number, t: number) {
    _a = (((_a + q) + _x + t) | 0);
    return ((_a << s) | (_a >>> (32 - s))) + _b;
  }
  function ff(_a: number, _b: number, _c: number, _d: number, _x: number, s: number, t: number) {
    return cmn((_b & _c) | (~_b & _d), _a, _b, _x, s, t);
  }
  function gg(_a: number, _b: number, _c: number, _d: number, _x: number, s: number, t: number) {
    return cmn((_b & _d) | (_c & ~_d), _a, _b, _x, s, t);
  }
  function hh(_a: number, _b: number, _c: number, _d: number, _x: number, s: number, t: number) {
    return cmn(_b ^ _c ^ _d, _a, _b, _x, s, t);
  }
  function ii(_a: number, _b: number, _c: number, _d: number, _x: number, s: number, t: number) {
    return cmn(_c ^ (_b | ~_d), _a, _b, _x, s, t);
  }
  function add32(x: number, y: number) { return (x + y) & 0xffffffff; }

  a = ff(a, b, c, d, k[0], 7, -680876936);
  d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819);
  b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897);
  d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341);
  b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416);
  d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063);
  b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682);
  d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290);
  b = ff(b, c, d, a, k[15], 22, 1236535329);
  a = gg(a, b, c, d, k[1], 5, -165796510);
  d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713);
  b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691);
  d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335);
  b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438);
  d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961);
  b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467);
  d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473);
  b = gg(b, c, d, a, k[12], 20, -1926607734);
  a = hh(a, b, c, d, k[5], 4, -378558);
  d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562);
  b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060);
  d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632);
  b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174);
  d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979);
  b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487);
  d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520);
  b = hh(b, c, d, a, k[2], 23, -995338651);
  a = ii(a, b, c, d, k[0], 6, -198630844);
  d = ii(d, a, b, c, k[7], 10, 1126898145);
  c = ii(c, d, a, b, k[14], 15, -1416354905);
  b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571);
  d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523);
  b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359);
  d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380);
  b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070);
  d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787126);
  b = ii(b, c, d, a, k[9], 21, -343485551);
  x[0] = add32(a, x[0]);
  x[1] = add32(b, x[1]);
  x[2] = add32(c, x[2]);
  x[3] = add32(d, x[3]);
}

function md5blk(s: string): number[] {
  const md5blks: number[] = [];
  for (let i = 0; i < 64; i += 4) {
    md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
  }
  return md5blks;
}

function md51(s: string): number[] {
  const n = s.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i: number;
  for (i = 0; i + 64 <= n; i += 64) {
    md5cycle(state, md5blk(s.substring(i, i + 64)));
  }
  const tailStr = s.substring(i);
  const tail: number[] = md5blk(tailStr + '\x80');
  // Zero out padding positions, then set bit length at positions 14, 15.
  for (let j = (tailStr.length >> 2) + 1; j < 14; j++) tail[j] = 0;
  const bitLen = n * 8;
  tail[14] = bitLen & 0xffffffff;
  tail[15] = Math.floor(bitLen / 0x100000000);
  if (tailStr.length > 55) {
    md5cycle(state, tail);
    md5cycle(state, md5blk('\x00'.repeat(64)));
  } else {
    md5cycle(state, tail);
  }
  return state;
}

function rhex(n: number): string {
  let s = '';
  for (let j = 0; j < 4; j++) {
    s += ((n >> (j * 8 + 4)) & 0x0f).toString(16) + ((n >> (j * 8)) & 0x0f).toString(16);
  }
  return s;
}

function hex(x: number[]): string {
  return x.map(rhex).join('');
}

/** Sync MD5 — used by gravatarUrlSync(). */
function md5(input: string): string {
  // MD5 requires UTF-8 encoded input.
  const utf8 = unescape(encodeURIComponent(input));
  return hex(md51(utf8));
}

/**
 * Sync Gravatar URL using MD5 (legacy, but the only sync option —
 * SHA-256 via crypto.subtle is async-only).
 */
export function gravatarUrlSync(email: string | undefined, size = 24): string {
  if (!email) return '';
  const normalized = email.trim().toLowerCase();
  if (!normalized) return '';
  const hash = md5(normalized);
  return `${GRAVATAR_BASE}${hash}?s=${size}&d=identicon&r=g`;
}

/**
 * Async Gravatar URL using SHA-256 via crypto.subtle (preferred).
 * Works in all modern browsers + Electron + Tauri.
 */
export async function gravatarUrl(email: string | undefined, size = 24): Promise<string> {
  if (!email) return '';
  const normalized = email.trim().toLowerCase();
  if (!normalized) return '';
  try {
    const data = new TextEncoder().encode(normalized);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return `${GRAVATAR_BASE}${hashHex}?s=${size}&d=identicon&r=g`;
  } catch {
    // Fallback to sync MD5 if crypto.subtle is unavailable.
    return gravatarUrlSync(email, size);
  }
}

/**
 * Decide whether a given email is likely to have a Gravatar.
 * Changed: now returns true for ALL valid emails — Gravatar returns
 * an identicon (auto-generated avatar) for emails without an account,
 * so the image always loads. Previously limited to GitHub/GitLab
 * addresses, which meant most commit authors showed initials instead
 * of Gravatar images.
 */
export function likelyHasGravatar(email: string | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  return true;
}
