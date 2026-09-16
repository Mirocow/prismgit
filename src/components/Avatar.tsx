import { memo, useEffect, useState } from 'react';
import { getInitials, getAuthorColor } from '../lib/authorBadges';
import { gravatarUrlSync, likelyHasGravatar } from '../lib/gravatar';

/**
 * In-memory avatar URL cache — keyed by `email|size` or `avatarUrl|size`.
 *
 * Without this cache, every render of a History page with 100 commits
 * would recompute the Gravatar hash + fire a network request for each
 * author. With the cache, the URL is computed once and reused.
 *
 * The cache is module-level (shared across all Avatar instances) and
 * never cleared — avatar URLs are deterministic (email → hash → URL),
 * so there's no staleness concern.
 */
const avatarUrlCache = new Map<string, string>();
const avatarImgFailed = new Set<string>(); // URLs that failed to load (404, network error)

/**
 * Avatar — shows a Gravatar image (if available) with a colored-initial
 * fallback. Used in History / Changes / Search / Pull Requests for commit
 * author badges.
 *
 * The component:
 *  - First renders the colored-initial fallback synchronously so the
 *    layout doesn't shift on mount.
 *  - Computes the avatar URL synchronously (MD5-based, no async needed).
 *    Uses the module-level cache so repeated authors don't recompute.
 *  - Lazy-loads the image; on success, swaps to the image.
 *  - On image load failure, caches the failure and falls back to initials
 *    permanently for that URL (no retry on every render).
 *
 * `size` is the avatar diameter in px (default 24).
 */
export const Avatar = memo(function Avatar({
  name,
  email,
  size = 24,
  className = '',
  avatarUrl,
}: {
  name: string;
  email?: string;
  size?: number;
  className?: string;
  /** Direct avatar URL from GitHub/GitLab API (takes priority over Gravatar). */
  avatarUrl?: string;
}) {
  // Compute the avatar URL synchronously — no async needed.
  // Priority: avatarUrl (GitHub/GitLab API) > Gravatar from email > initials.
  const cacheKey = avatarUrl ? `url:${avatarUrl}:${size}` : `email:${email || ''}:${size}`;

  let url: string | null = null;
  if (avatarUrl) {
    // Direct URL from provider API — use as-is.
    url = avatarUrl;
  } else if (email && likelyHasGravatar(email)) {
    // Check cache first.
    const cached = avatarUrlCache.get(cacheKey);
    if (cached) {
      url = cached;
    } else {
      // Compute synchronously using MD5 (gravatarUrlSync).
      // We use MD5 instead of SHA-256 because crypto.subtle (SHA-256) is
      // async-only and may be UNAVAILABLE in Electron's renderer process
      // when running in dev mode (http://localhost is not a secure context).
      // MD5 is Gravatar's legacy hash but still fully supported.
      url = gravatarUrlSync(email, size * 2 /* retina */);
      avatarUrlCache.set(cacheKey, url);
    }
  }

  // If this URL previously failed to load, don't try again — show initials.
  if (url && avatarImgFailed.has(url)) {
    url = null;
  }

  const [imgOk, setImgOk] = useState(false);

  // Reset imgOk when URL changes.
  useEffect(() => {
    setImgOk(false);
  }, [url]);

  const initials = getInitials(name);
  const { bg, text } = getAuthorColor(name);

  if (imgOk && url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => {
          // Cache the failure so we don't retry on every render.
          avatarImgFailed.add(url);
          setImgOk(false);
        }}
        loading="lazy"
      />
    );
  }

  // Initials fallback — colored badge with 1-2 letter initials.
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full flex-shrink-0 font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        color: text,
        fontSize: Math.max(8, Math.floor(size * 0.4)),
      }}
      title={name + (email ? ` <${email}>` : '')}
    >
      {initials}
    </span>
  );
});
