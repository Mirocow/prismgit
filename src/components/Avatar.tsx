import { memo, useEffect, useState } from 'react';
import { getInitials, getAuthorColor } from '../lib/authorBadges';
import { gravatarUrlSync, likelyHasGravatar } from '../lib/gravatar';

/**
 * Avatar — shows a cached avatar image with a colored-initial fallback.
 *
 * HOW IT WORKS:
 * 1. Compute the avatar URL synchronously (MD5 for Gravatar, or direct
 *    avatarUrl from GitHub/GitLab API).
 * 2. Call `api.avatar.get(url)` — this is an IPC call to the main process
 *    which downloads the image ONCE, saves it to
 *    <userData>/avatar-cache/<hash>.png, and returns it as a data URI.
 * 3. Subsequent calls for the same URL return the cached data URI
 *    instantly — no network, no flicker.
 * 4. On failure (network down, 404, timeout), falls back to colored
 *    initials. The failure is cached so we don't retry on every render.
 *
 * PERFORMANCE:
 * - In-memory cache (Map) in the main process → 0 IPC round-trips for
 *   repeated avatars.
 * - Disk cache → survives app restarts.
 * - In-flight dedup → if two Avatar components request the same URL
 *   simultaneously, only one download happens.
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
  // Compute the source URL for the avatar.
  const sourceUrl = avatarUrl
    || (email && likelyHasGravatar(email)
      ? gravatarUrlSync(email, Math.max(size * 2, 48))
      : '');

  const [dataUri, setDataUri] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceUrl) {
      setDataUri(null);
      return;
    }
    let cancelled = false;
    // Call the main process to get the cached/downloaded avatar.
    // This returns a data URI string (or null if the download failed).
    void window.smartgit.avatar.get(sourceUrl).then((uri: string | null) => {
      if (!cancelled) setDataUri(uri);
    }).catch(() => {
      if (!cancelled) setDataUri(null);
    });
    return () => { cancelled = true; };
  }, [sourceUrl]);

  const initials = getInitials(name);
  const { bg, text } = getAuthorColor(name);

  if (dataUri) {
    return (
      <img
        src={dataUri}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
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
