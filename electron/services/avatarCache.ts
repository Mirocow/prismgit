/**
 * Avatar cache service — downloads and caches avatar images on disk.
 *
 * WHY: previously every Avatar component instance fired a network request
 * to gravatar.com (or GitHub/GitLab) on every render. On a History page
 * with 100 commits by 5 authors = 5 network requests per page load, plus
 * image flicker on every re-render. On slow connections the avatars
 * would take 1-3 seconds to appear, and if gravatar.com was down, they
 * would never appear at all.
 *
 * NOW: the main process downloads each avatar ONCE, saves it to
 * <userData>/avatar-cache/<hash>.png, and subsequent requests return the
 * cached file as a data URI — no network, no flicker, works offline.
 *
 * The cache is keyed by a hash of the source URL (gravatar or provider
 * avatar URL). Files are never expired — avatar images are immutable
 * (the URL contains the hash of the email, so it always returns the
 * same image).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { app } from 'electron';

const CACHE_DIR = path.join(app.getPath('userData'), 'avatar-cache');

// Ensure the cache directory exists.
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch { /* ignore — will be created on first download */ }

/** Simple hash for the cache filename — not cryptographic, just unique per URL. */
function urlHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) - h) + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function cachePath(url: string): string {
  return path.join(CACHE_DIR, `${urlHash(url)}.png`);
}

/**
 * Download a URL and return the content as a Buffer.
 * Returns null on any error (network failure, non-200, timeout).
 */
function download(url: string, timeoutMs = 5000): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'PrismGit/1.0' },
    }, (res) => {
      if (res.statusCode !== 200) {
        // Non-200 (404, 403, etc.) — no avatar available.
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(buf.length > 0 ? buf : null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** In-memory cache: URL → data URI (so we don't hit disk on every call). */
const memCache = new Map<string, string | null>();
/** In-flight downloads (prevent duplicate concurrent downloads). */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Get a cached avatar as a data URI string.
 *
 * 1. Check in-memory cache → return immediately if hit.
 * 2. Check disk cache → read file, convert to data URI, cache in memory.
 * 3. Download from network → save to disk → cache in memory.
 * 4. On any failure → return null (renderer falls back to initials).
 *
 * The promise NEVER rejects — failures return null.
 */
export async function getCachedAvatar(url: string): Promise<string | null> {
  // 1. In-memory cache.
  const memHit = memCache.get(url);
  if (memHit !== undefined) return memHit;

  // 2. In-flight download — don't start a second download for the same URL.
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    const filePath = cachePath(url);

    // 2. Disk cache.
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        if (buf.length > 0) {
          const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
          memCache.set(url, dataUri);
          return dataUri;
        }
      }
    } catch { /* ignore disk read errors */ }

    // 3. Download.
    try {
      const buf = await download(url);
      if (!buf || buf.length === 0) {
        memCache.set(url, null);
        return null;
      }
      // Save to disk (best effort — if it fails, we still return the data URI).
      try {
        fs.writeFileSync(filePath, buf);
      } catch { /* ignore disk write errors */ }
      const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
      memCache.set(url, dataUri);
      return dataUri;
    } catch {
      memCache.set(url, null);
      return null;
    }
  })();

  inFlight.set(url, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(url);
  }
}

/**
 * Build a Gravatar URL from an email address (MD5 hash, sync).
 */
export function gravatarUrlFromEmail(email: string, size = 48): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return '';
  const crypto = require('crypto') as typeof import('crypto');
  const hash = crypto.createHash('md5').update(normalized).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon&r=g`;
}
