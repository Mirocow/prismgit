/**
 * lowLevelProps.ts — SmartGit-style Low-level Properties model (phase 4.1).
 *
 * Two storage layers:
 *   1. settings.lowLevelProperties — the LEGACY textarea string ("key=value"
 *      per line, '#' comments). Kept for backward compatibility; the 4.1
 *      settings UI migrates it into a parsed map.
 *   2. Typed getters below — the ONLY supported read path for consumers.
 *
 * The registry documents every key the app understands: type, default,
 * whether a restart is required, and a short description for the future
 * settings table. Unknown keys in the textarea are passed through by the
 * parser but ignored by getters until a consumer adopts them.
 */

/** Metadata for one low-level property (drives the 4.1 settings table). */
export interface LowLevelPropMeta {
  key: string;
  type: 'boolean' | 'number' | 'string';
  default: boolean | number | string;
  /** Changing the value requires an app restart to take effect. */
  restart?: boolean;
  description: string;
}

/** The known low-level property registry (SmartGit smartgit.properties analog). */
export const LOW_LEVEL_PROPS: LowLevelPropMeta[] = [
  {
    key: 'renames.warnMs',
    type: 'number',
    default: 3000,
    description:
      'Threshold in ms after which working-tree rename detection is considered slow and a one-time hint toast is shown (if warnSlowRenameDetection is on).',
  },
  {
    key: 'renames.similarityThreshold',
    type: 'number',
    default: 50,
    description: 'Similarity percentage passed to git --find-renames (0–100).',
  },
  {
    key: 'dates.verboseDays',
    type: 'number',
    default: 7,
    description: 'Age threshold (days) below which dates render verbosely ("Today", "Yesterday", "N days ago").',
  },
  {
    key: 'backgroundFetch.intervalMin',
    type: 'number',
    default: 5,
    description: 'Minimum interval in minutes between background fetches of the same repository remote.',
  },
  {
    key: 'avatar.size',
    type: 'number',
    default: 20,
    description: 'Author avatar size in pixels in commit lists.',
  },
  {
    key: 'annotate.maxTooltipWidth',
    type: 'number',
    default: 560,
    description: 'Max width in px of the annotate/blame tooltip.',
  },
];

const REGISTRY = new Map(LOW_LEVEL_PROPS.map((p) => [p.key, p]));

/** Parse the legacy textarea string into a map. Unknown keys are preserved. */
export function parseLowLevelProperties(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Serialize a map back to the textarea format (stable key order). */
export function serializeLowLevelProperties(map: Record<string, string | number | boolean>): string {
  return Object.keys(map)
    .sort()
    .map((k) => `${k}=${String(map[k])}`)
    .join('\n');
}

function coerce(
  meta: LowLevelPropMeta | undefined,
  value: string | number | boolean | undefined
): boolean | number | string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!meta) return value;
  if (meta.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (meta.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return undefined;
  }
  return String(value);
}

/**
 * Read a low-level number property. Lookup order:
 *   settings.lowLevelProperties (legacy textarea) — key=value line wins
 *   registry default otherwise.
 */
export function getLowLevelNumber(
  settings: { lowLevelProperties?: string } | undefined,
  key: string
): number {
  const meta = REGISTRY.get(key);
  const fallback = typeof meta?.default === 'number' ? meta.default : 0;
  const parsed = parseLowLevelProperties(settings?.lowLevelProperties);
  const v = coerce(meta, parsed[key]);
  return typeof v === 'number' ? v : fallback;
}

/** Read a low-level string property (registry default when unset). */
export function getLowLevelString(
  settings: { lowLevelProperties?: string } | undefined,
  key: string
): string {
  const meta = REGISTRY.get(key);
  const fallback = typeof meta?.default === 'string' ? meta.default : '';
  const parsed = parseLowLevelProperties(settings?.lowLevelProperties);
  const v = coerce(meta, parsed[key]);
  return typeof v === 'string' ? v : fallback;
}

/** Read a low-level boolean property (registry default when unset). */
export function getLowLevelBool(
  settings: { lowLevelProperties?: string } | undefined,
  key: string
): boolean {
  const meta = REGISTRY.get(key);
  const fallback = typeof meta?.default === 'boolean' ? meta.default : false;
  const parsed = parseLowLevelProperties(settings?.lowLevelProperties);
  const v = coerce(meta, parsed[key]);
  return typeof v === 'boolean' ? v : fallback;
}
