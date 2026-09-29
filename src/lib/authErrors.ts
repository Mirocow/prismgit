/**
 * authErrors — classify HTTP(S) authentication failures into actionable kinds,
 * so the UI can ask the user for the missing login/password (and save it)
 * instead of the old raw-stderr toast the user can do nothing about.
 *
 * User report (the trigger for this module — the NEXT step of the same
 * corporate-server story as sslErrors):
 *   «Ошибка pull
 *    Error invoking remote method 'git:pull': Error: Authentication failed —
 *    … fatal: could not read Username for
 *    'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled»
 *   — «должен быть запрос логина и пароля у пользователя когда приходит эта
 *      ошибка и потом пароль и логин сохранять в сторадже»
 *
 * The server REQUIRED authentication, the app had no stored credentials for
 * the remote, and git — running with GIT_TERMINAL_PROMPT=0 (a GUI must never
 * block on a terminal prompt) — failed with "could not read Username". The
 * sanctioned reaction is exactly what SmartGit/GitKraken do: pop up a
 * credentials dialog, store the answer per repo+remote (the remoteAuth
 * settings map — password in the encrypted vault), retry the operation.
 *
 * The classifier is deliberately shared between the main process
 * (describeNetworkError hint) and the renderer (offerAuthBypass →
 * RemoteAuthDialog) — the SAME message shapes are recognized everywhere,
 * like sslErrors/pushFailures do for their classes.
 *
 * NOT matched on purpose (credentials cannot help): TLS certificate
 * failures (sslErrors owns them), transport failures (timeouts, refused,
 * DNS), SSH publickey problems (ssh.ts owns them), remote-side push
 * rejections (pushFailures owns them) — classifyAuthFailure returns null
 * for all of those and the caller keeps its generic error path.
 */

export type AuthFailureKind =
  /** git never HAD credentials to send (prompt refused — the GUI case). */
  | 'no-credentials'
  /** Credentials were sent and REJECTED (wrong password / expired token). */
  | 'bad-credentials'
  /** Authenticated, but the account lacks access to the resource (403). */
  | 'forbidden'
  /** Generic HTTP auth failure. */
  | 'other';

export interface AuthFailureInfo {
  kind: AuthFailureKind;
  /** Remote host extracted from the failing URL (git stderr carries it). */
  host?: string;
  /** Remote URL extracted from the message, when present. */
  url?: string;
  /** Trimmed, size-capped raw message for the dialog's details block. */
  message: string;
}

/**
 * Pattern table — ORDER MATTERS (most specific wins):
 *   no-credentials → bad-credentials → forbidden → generic.
 *
 * 'could not read Username … terminal prompts disabled' is the shape git
 * prints with GIT_TERMINAL_PROMPT=0 when NOTHING was sent; 'Authentication
 * failed' / 'HTTP Basic: Access denied' is what the server answers when
 * something WAS sent and rejected; 403 means the identity is fine but the
 * permission is not.
 */
const PATTERNS: Array<{ kind: AuthFailureKind; re: RegExp }> = [
  {
    kind: 'no-credentials',
    re: /could not read (?:Username|Password)|terminal prompts disabled/i,
  },
  {
    kind: 'bad-credentials',
    re:
      /Authentication failed|authentication required|HTTP Basic: Access denied|Authorization failed|HTTP 401|401 Unauthorized|The requested URL returned error: 401/i,
  },
  {
    kind: 'forbidden',
    re: /HTTP 403|403 Forbidden|The requested URL returned error: 403/i,
  },
  {
    // Generic auth marker (some proxies phrase it differently).
    kind: 'other',
    re: /authorization required/i,
  },
];

/** Cap the raw output embedded in the dialog (stderr can be huge). */
const MAX_RAW = 1600;

/** Pull the first http(s) URL out of a git error message. */
const URL_RE = /https?:\/\/[^\s'"<>)]+/;

function extractUrl(raw: string): string | undefined {
  const m = raw.match(URL_RE);
  if (!m) return undefined;
  // git quotes the URL: "…read Username for 'https://host/path': …" — the
  // match stops at the quote, but tolerate stray trailing punctuation.
  return m[0].replace(/[.,;:]+$/, '');
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    // Not a parseable URL — leave the host out rather than guess.
    return undefined;
  }
}

/**
 * Classify an error as an HTTP(S) authentication failure (or not).
 * Returns null for everything credentials cannot fix — callers then keep
 * their generic error handling (toast / other dialogs).
 */
export function classifyAuthFailure(err: unknown): AuthFailureInfo | null {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (!raw) return null;
  for (const { kind, re } of PATTERNS) {
    if (re.test(raw)) {
      const url = extractUrl(raw);
      return {
        kind,
        url,
        host: hostOf(url),
        message: raw.trim().slice(0, MAX_RAW),
      };
    }
  }
  return null;
}

/** Human label for a kind — used by tests and diagnostics (UI uses i18n). */
export const AUTH_KIND_LABELS: Record<AuthFailureKind, string> = {
  'no-credentials': 'no credentials stored for this remote',
  'bad-credentials': 'credentials were rejected by the server',
  forbidden: 'authenticated, but access denied (403)',
  other: 'HTTP authentication failed',
};
