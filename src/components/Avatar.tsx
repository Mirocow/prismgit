import { memo, useState } from 'react';
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
 *  - Lazily loads the Gravatar image (via <img src>) only when the email
 *    matches a provider likely to have a real Gravatar (GitHub, GitLab
 *    noreply addresses). This avoids a network round-trip for every
 *    commit author in the list.
 *  - On image load success, swaps to the image.
 *  - On image load failure, falls back to the initials (e.g. user is
 *    offline, or Gravatar is blocked).
 *
 * `size` is the avatar diameter in px (default 24).
 */
export const Avatar = memo(function Avatar({
  name,
  email,
  size = 24,
  className = '',
}: {
  name: string;
  email?: string;
  size?: number;
  className?: string;
}) {
  const [imgOk, setImgOk] = useState(false);
  const [imgTried, setImgTried] = useState(false);
  const initials = getInitials(name);
  const { bg, text } = getAuthorColor(name);
  const shouldTryGravatar = !imgTried && email && likelyHasGravatar(email);
  const url = shouldTryGravatar ? gravatarUrl(email, size * 2 /* retina */) : '';

  if (imgOk && url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => { setImgTried(true); setImgOk(false); }}
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
