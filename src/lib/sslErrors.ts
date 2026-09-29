/**
 * sslErrors — classify TLS certificate failures into actionable kinds, so the
 * UI can offer the user a REACTION (disable verification for this repo and
 * retry) instead of the old raw-stderr toast the user can do nothing about.
 *
 * User report (the trigger for this whole module):
 *   «Ошибка pull
 *    Error invoking remote method 'git:pull': Error: fatal: unable to access
 *    'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git/':
 *    SSL certificate problem: certificate has expired»
 *   — «Надо научиться обходить такие ошибки»
 *
 * An internal corporate Git server with an expired / self-signed / unknown-CA
 * certificate breaks EVERY network operation (pull, push, fetch, clone) and
 * every provider API call. The sanctioned workaround (same one SmartGit,
 * GitKraken and VS Code offer) is `http.sslVerify=false` scoped to the ONE
 * repository, plus `rejectUnauthorized:false` for API calls to that host.
 *
 * The classifier is deliberately shared between the main process
 * (describeNetworkError hint, GitLab/GitHub API error handling) and the
 * renderer (offerSslBypass → SslBypassDialog) — the SAME message shapes are
 * recognized everywhere, like rawGitErrors/pushFailures do for their classes.
 *
 * NOT matched on purpose (disabling verification cannot help): transport
 * failures such as 'Connection timed out', 'SSL_ERROR_SYSCALL',
 * 'wrong version number', 'Failed to connect' — classifySslFailure returns
 * null for those and the caller keeps its generic error path.
 */

export type SslFailureKind =
  | 'expired'
  | 'not-yet-valid'
  | 'self-signed'
  | 'untrusted'
  | 'hostname'
  | 'revoked'
  | 'other';

export interface SslFailureInfo {
  kind: SslFailureKind;
  /** Remote host extracted from the failing URL (git stderr carries it). */
  host?: string;
  /** Remote URL extracted from the message, when present. */
  url?: string;
  /** Trimmed, size-capped raw message for the dialog's details block. */
  message: string;
}

/**
 * Pattern table — ORDER MATTERS (most specific wins):
 *   revoked → not-yet-valid → expired → hostname → self-signed → untrusted
 * → generic.
 * 'self signed certificate in certificate chain' carries BOTH a self-signed
 * marker and a chain-trust problem — self-signed is the more specific,
 * actionable label. 'SSL certificate problem: certificate has expired'
 * carries the generic marker AND the expired reason — expired wins.
 */
const PATTERNS: Array<{ kind: SslFailureKind; re: RegExp }> = [
  {
    kind: 'revoked',
    re: /certificate(?:'s)? (?:has been )?revoked|CERT_HAS_BEEN_REVOKED|CERT_REVOKED/i,
  },
  {
    kind: 'not-yet-valid',
    re: /certificate is not yet valid|CERT_NOT_YET_VALID|certificate not.*yet valid/i,
  },
  {
    kind: 'expired',
    re: /certificate (?:has|is) expired|CERT_HAS_EXPIRED/i,
  },
  {
    kind: 'hostname',
    re:
      /hostname mismatch|does not match (?:the )?target host|ERR_TLS_CERT_ALTNAME_INVALID|certificate is not valid for|no alternative certificate subject name matches/i,
  },
  {
    kind: 'self-signed',
    re: /self[- ]signed certificate|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN/i,
  },
  {
    kind: 'untrusted',
    re:
      /unable to get local issuer certificate|unable to get issuer certificate|unable to verify the first certificate|certificate verify failed|server certificate verification failed|server verification failed|certificate signer not trusted|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|CERT_CHAIN_TOO_LONG/i,
  },
  {
    // Generic curl/git TLS trust failure: 'SSL certificate problem: …'
    kind: 'other',
    re: /SSL certificate problem|SSL certificate verification|SSL peer certificate/i,
  },
];

/** Cap the raw output embedded in the dialog (stderr can be huge). */
const MAX_RAW = 1600;

/** Pull the first http(s) URL out of a git error message. */
const URL_RE = /https?:\/\/[^\s'"<>)]+/;

function extractUrl(raw: string): string | undefined {
  const m = raw.match(URL_RE);
  if (!m) return undefined;
  // git quotes the URL: "…access 'https://host/repo.git/': …" — the match
  // stops at the quote, but tolerate stray trailing punctuation just in case.
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
 * Classify an error as a TLS certificate failure (or not).
 * Returns null for everything that is not a certificate problem — callers
 * then keep their generic error handling (toast / dialog).
 */
export function classifySslFailure(err: unknown): SslFailureInfo | null {
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
export const SSL_KIND_LABELS: Record<SslFailureKind, string> = {
  expired: 'certificate has expired',
  'not-yet-valid': 'certificate is not yet valid',
  'self-signed': 'self-signed / private-CA certificate',
  untrusted: 'certificate chain cannot be verified',
  hostname: 'certificate does not match the server name',
  revoked: 'certificate has been revoked',
  other: 'certificate rejected by the TLS trust check',
};
