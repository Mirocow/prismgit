#!/bin/bash
# Full comprehensive E2E run — Xvfb + nohup (user requirement).
# Usage: nohup bash run-e2e-full.sh > /tmp/e2e-full-run.log 2>&1 &
cd /home/z/my-project/gitclient
export PATH=/home/z/my-project/bin:$PATH
echo "=== FULL E2E RUN — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
echo "HEAD: $(git rev-parse HEAD)"
echo "=================================================="

# Run the ENTIRE e2e suite under Xvfb (auto display). The webServer (vite
# renderer-only) is started by playwright for accessibility.test.ts.
xvfb-run -a npx playwright test
STATUS=$?

echo "=================================================="
echo "E2E EXIT CODE: $STATUS — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
exit $STATUS
