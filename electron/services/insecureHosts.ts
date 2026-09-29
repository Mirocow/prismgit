/**
 * insecureHosts — hosts whose TLS certificates PrismGit deliberately does
 * NOT verify for provider API requests (GitLab/GitHub REST, avatar
 * downloads).
 *
 * WHY: an internal corporate Git server with an expired / self-signed
 * certificate breaks not only git itself (pull/push/fetch — handled by
 * http.sslVerify=false in the repo's local config, see SslBypassDialog)
 * but ALSO every main-process HTTPS call to the same host: MR lists,
 * pipelines, comments, avatars. Node's https module rejects the
 * certificate with UNABLE_TO_VERIFY_LEAF_SIGNATURE /
 * 'certificate has expired' before the request is even sent.
 *
 * SECURITY CONTRACT: the list is only ever written by an EXPLICIT user
 * decision — the «Continue without certificate verification» button in
 * SslBypassDialog (or the Security settings UI). Entries are hosts, never
 * URLs; the traffic stays TLS-encrypted, only the trust check is dropped
 * per host. The user can review and clear the list in
 * Settings → Security → SSL/TLS.
 */
import { getSetting, setSetting } from './storage.js';

const KEY = 'insecureSslHosts';

/** Cached lowercase host set — rebuilt on first read and after every write. */
let cache: Set<string> | null = null;

function loadList(): string[] {
  const raw = getSetting<unknown>(KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    .map((h) => h.trim().toLowerCase());
}

function flush(list: string[]): void {
  setSetting(KEY, list);
  cache = new Set(list);
}

/** True when TLS certificate verification is disabled for this host. */
export function isInsecureSslHost(host: string | undefined | null): boolean {
  if (!host) return false;
  if (!cache) cache = new Set(loadList());
  return cache.has(host.trim().toLowerCase());
}

/** All hosts with verification disabled (lowercase, for the settings UI). */
export function getInsecureSslHosts(): string[] {
  if (!cache) cache = new Set(loadList());
  return [...cache];
}

/** Register a host — idempotent. Called by the SslBypass confirm. */
export function addInsecureSslHost(host: string): void {
  const clean = host.trim().toLowerCase();
  if (!clean) return;
  const list = getInsecureSslHosts();
  if (list.includes(clean)) return;
  list.push(clean);
  flush(list);
}

/** Remove a host (Settings → Security → SSL/TLS). Idempotent. */
export function removeInsecureSslHost(host: string): void {
  const clean = host.trim().toLowerCase();
  const list = getInsecureSslHosts().filter((h) => h !== clean);
  flush(list);
}
