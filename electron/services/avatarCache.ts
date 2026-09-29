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
import { isInsecureSslHost } from './insecureHosts.js';

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
      // TLS bypass for hosts the user EXPLICITLY marked insecure via the
      // SslBypassDialog — see gitlab.ts apiJsonRequest for the contract.
      // Avatars come from the SAME corporate server whose certificate git
      // already rejects; without this they silently never load.
      ...(u.protocol === 'https:' && isInsecureSslHost(u.hostname) ? { rejectUnauthorized: false } : {}),
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

/**
 * In-memory cache: URL → data URI (so we don't hit disk on every call).
 *
 * MEMORY FIX (M2): previously unbounded — a session with 1000 unique
 * authors (large OSS projects) accumulated ~25 MB of base64 data URIs.
 * Now bounded by LRU with 500 entries — covers 99 % of real workloads.
 *
 * Negative (null) entries now have a TTL: a user who has since registered
 * a gravatar would otherwise be stuck with the cached "no avatar" result
 * forever. NULL_TTL_MS = 5 min — long enough to avoid thrashing during a
 * single History session, short enough to recover from transient 404s.
 */
const MEM_CACHE_MAX = 500;
const NULL_TTL_MS = 5 * 60 * 1000;
const memCache = new Map<string, { value: string | null; ts: number }>();
/** In-flight downloads (prevent duplicate concurrent downloads). */
const inFlight = new Map<string, Promise<string | null>>();

function memCacheGet(url: string): string | null | undefined {
  const entry = memCache.get(url);
  if (!entry) return undefined;
  if (entry.value === null) {
    // Negative cache — respect TTL.
    if (Date.now() - entry.ts > NULL_TTL_MS) {
      memCache.delete(url);
      return undefined;
    }
    return null;
  }
  // Positive cache — avatars are immutable, no TTL.
  return entry.value;
}

function memCacheSet(url: string, value: string | null): void {
  // LRU: re-insert moves entry to the end (Map iterates in insertion order).
  memCache.delete(url);
  memCache.set(url, { value, ts: Date.now() });
  // Evict oldest entries while over capacity.
  while (memCache.size > MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
}

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
  // 1. In-memory cache (LRU + TTL for negatives).
  const memHit = memCacheGet(url);
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
          memCacheSet(url, dataUri);
          return dataUri;
        }
      }
    } catch { /* ignore disk read errors */ }

    // 3. Download.
    try {
      const buf = await download(url);
      if (!buf || buf.length === 0) {
        memCacheSet(url, null);
        return null;
      }
      // Save to disk (best effort — if it fails, we still return the data URI).
      try {
        fs.writeFileSync(filePath, buf);
      } catch { /* ignore disk write errors */ }
      const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
      memCacheSet(url, dataUri);
      return dataUri;
    } catch {
      memCacheSet(url, null);
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

