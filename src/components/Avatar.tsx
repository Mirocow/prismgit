import { memo, useEffect, useState } from 'react';
import { getInitials, getAuthorColor } from '../lib/authorBadges';
import { gravatarUrl, likelyHasGravatar } from '../lib/gravatar';

/**
 * Avatar — shows a Gravatar image (if available) with a colored-initial
 * fallback. Used in History / Changes / Blame / Journal for commit
 * author badges.
 *
 * The component:
 *  - First renders the colored-initial fallback synchronously so the
 *    layout doesn't shift on mount.
 *  - Asynchronously computes the Gravatar URL (via crypto.subtle SHA-256,
 *    no npm dependency) and lazy-loads the image.
 *  - Only fires the network request if the email is from a known
 *    provider (GitHub / GitLab noreply addresses) — avoids a network
 *    round-trip for every commit author in the list.
 *  - On image load success, swaps to the image.
 *  - On image load failure, falls back to the initials (offline / blocked).
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
  const [imgUrl, setImgUrl] = useState<string | null>(avatarUrl || null);
  const [imgOk, setImgOk] = useState(false);

  // If avatarUrl is provided directly (GitHub/GitLab API), use it.
  // Otherwise, compute the Gravatar URL from the email.
  useEffect(() => {
    let cancelled = false;

    // Direct URL from provider API (GitHub avatar_url, GitLab avatar_url)
    if (avatarUrl) {
      if (!cancelled) { setImgUrl(avatarUrl); setImgOk(false); }
      return () => { cancelled = true; };
    }

    // Gravatar from email
    if (!email || !likelyHasGravatar(email)) {
      setImgUrl(null);
      setImgOk(false);
      return;
    }
    void gravatarUrl(email, size * 2 /* retina */).then(url => {
      if (!cancelled) setImgUrl(url);
    }).catch(() => { if (!cancelled) setImgUrl(null); });
    return () => { cancelled = true; };
  }, [email, size, avatarUrl]);

  const initials = getInitials(name);
  const { bg, text } = getAuthorColor(name);

  if (imgOk && imgUrl) {
    return (
      <img
        src={imgUrl}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => { setImgOk(false); }}
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
