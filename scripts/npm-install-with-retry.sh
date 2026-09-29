#!/bin/sh
# -----------------------------------------------------------------------------
# npm-install-with-retry.sh — npm install/ci wrapper with mirror-404 recovery
# -----------------------------------------------------------------------------
# WHY THIS EXISTS
#   npm's `replace-registry-host` default ("npmjs") silently rewrites every
#   registry.npmjs.org URL in package-lock.json to the host of whatever
#   registry the machine has configured. On a machine whose global ~/.npmrc
#   points to a LAN mirror (Verdaccio/Nexus/cnpm, e.g. http://192.168.1.132),
#   ALL tarballs are fetched through that mirror. If the mirror lacks — or
#   has a cached negative (404) entry for — a single tarball the lockfile
#   needs (observed live: webcrypto-core@1.9.2 via electron-builder →
#   app-builder-lib → @peculiar/webcrypto), the whole install dies with E404
#   even though the package exists on the public registry.
#
# WHAT IT DOES
#   1. Runs `npm <forwarded args>` and tees the output to a temp log.
#   2. Success (npm's "added N packages"/"up to date" line, no "npm error"
#      lines) → prints a friendly EBADENGINE note if the current Node.js is
#      below some dev-deps' engines floor, exits 0.
#   3. Failure with E404 → explains the mirror gap and retries ONCE with
#      --registry=https://registry.npmjs.org (lockfile URLs then resolve
#      verbatim, bypassing the mirror). If the network cannot reach the
#      public registry, npm's own error becomes the final output.
#   4. Any other failure → exits 1; npm's output is already above.
#
# USAGE
#   sh scripts/npm-install-with-retry.sh install
#   sh scripts/npm-install-with-retry.sh ci --no-audit --no-fund
# -----------------------------------------------------------------------------
set -u

NPM="${NPM:-npm}"
PUBLIC_REGISTRY="https://registry.npmjs.org"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# `tee` swallows npm's exit status, so outcome is detected from the log:
# npm >= 7 writes "npm error …" lines only for real failures ("npm warn …"
# is non-fatal). Success always ends with an "added N packages" /
# "up to date" / "changed N packages" summary line. If neither an error nor
# a success line is present (killed process, disk full, …), we fail loudly
# instead of lying with a success exit code.
has_error()  { grep -qE '^(npm error|npm ERR!)' "$1"; }
has_e404()   { grep -q 'E404' "$1"; }
has_engine() { grep -q 'EBADENGINE' "$1"; }
has_success(){ grep -qE '(added [0-9]+ package|up to date|changed [0-9]+ package|removed [0-9]+ package)' "$1"; }

"$NPM" "$@" 2>&1 | tee "$log"

if has_error "$log"; then
  if has_e404 "$log"; then
    echo ""
    echo "→ npm got 404 from the configured registry — a mirror cache gap."
    echo "  The lockfile is clean (all URLs → registry.npmjs.org), but npm's"
    echo "  replace-registry-host default routes them through your registry,"
    echo "  which is missing that tarball."
    echo "  Retrying once against the public registry: $PUBLIC_REGISTRY"
    echo ""
    exec "$NPM" "$@" --registry="$PUBLIC_REGISTRY"
  fi
  echo "✗ npm failed — see the output above" >&2
  exit 1
fi

if ! has_success "$log"; then
  echo "✗ npm produced neither a success summary nor an error line" >&2
  echo "  (killed? disk full?) — treating as FAILURE, refusing to fake success" >&2
  exit 1
fi

if has_engine "$log"; then
  echo ""
  echo "→ Note: some dev dependencies want a newer Node.js than the current one"
  echo "  (EBADENGINE warnings above — the install itself succeeded)."
  echo "  Recommended: node >= 22.22.2 / 24 LTS / 26, e.g. 'nvm install 24'."
fi
