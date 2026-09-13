#!/bin/bash
#
# create-conflict-scenarios.sh
# ============================
# Creates 6 test repos with different conflict types to exercise every
# resolution path in the PrismGit 3-way merge tool.
#
# Scenarios:
#   1. simple-content   — single hunk, both sides changed the same line
#   2. multiple-hunks    — 3 conflict hunks in one file
#   3. multi-file        — conflicts in 3 different files
#   4. add-delete        — file added in one branch, deleted in other
#   5. nested-path       — conflict in deeply nested src/components/X.tsx
#   6. json-conflict     — JSON file with structured conflict markers
#
set -euo pipefail

git config --global user.email "test@test.com" 2>/dev/null || true
git config --global user.name "Test User" 2>/dev/null || true
BASE="/tmp/conflict-scenarios"
rm -rf "$BASE" && mkdir -p "$BASE"

# ── 1. Simple content conflict ─────────────────────────────────────
echo "[1/6] simple-content..."
mkdir -p "$BASE/simple-content" && cd "$BASE/simple-content"
git init -b main -q
printf 'line1\nline2\nline3\n' > file.txt
git add . && git commit -q -m "init"
git checkout -b feature -q
printf 'line1\nFEATURE\nline3\n' > file.txt
git add . && git commit -q -m "feature change"
git checkout main -q
printf 'line1\nMAIN\nline3\n' > file.txt
git add . && git commit -q -m "main change"
git merge feature 2>/dev/null || true
echo "  ✓ single hunk conflict in file.txt"

# ── 2. Multiple hunks in one file ──────────────────────────────────
echo "[2/6] multiple-hunks..."
mkdir -p "$BASE/multiple-hunks" && cd "$BASE/multiple-hunks"
git init -b main -q
printf 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n' > file.txt
git add . && git commit -q -m "init"
git checkout -b feature -q
printf 'line1\nFEAT2\nline3\nline4\nFEAT5\nline6\nline7\nFEAT8\nline9\n' > file.txt
git add . && git commit -q -m "feature: 3 hunks changed"
git checkout main -q
printf 'line1\nMAIN2\nline3\nline4\nMAIN5\nline6\nline7\nMAIN8\nline9\n' > file.txt
git add . && git commit -q -m "main: 3 hunks changed"
git merge feature 2>/dev/null || true
echo "  ✓ 3 conflict hunks in file.txt"

# ── 3. Multi-file conflict ─────────────────────────────────────────
echo "[3/6] multi-file..."
mkdir -p "$BASE/multi-file" && cd "$BASE/multi-file"
git init -b main -q
echo "content1" > file_a.ts
echo "content2" > file_b.py
echo "content3" > file_c.go
git add . && git commit -q -m "init"
git checkout -b feature -q
echo "FEATURE_A" > file_a.ts
echo "FEATURE_B" > file_b.py
echo "FEATURE_C" > file_c.go
git add . && git commit -q -m "feature changes all 3"
git checkout main -q
echo "MAIN_A" > file_a.ts
echo "MAIN_B" > file_b.py
echo "MAIN_C" > file_c.go
git add . && git commit -q -m "main changes all 3"
git merge feature 2>/dev/null || true
echo "  ✓ 3 files with conflicts (file_a.ts, file_b.py, file_c.go)"

# ── 4. Add vs delete conflict ──────────────────────────────────────
echo "[4/6] add-delete..."
mkdir -p "$BASE/add-delete" && cd "$BASE/add-delete"
git init -b main -q
echo "shared" > shared.txt
git add . && git commit -q -m "init"
git checkout -b feature -q
echo "new file from feature" > newfile.txt
git add . && git commit -q -m "feature: add newfile"
git checkout main -q
# Main doesn't touch newfile — but we create a conflict differently
# by having main delete shared.txt while feature modifies it
git rm -q shared.txt
git commit -q -m "main: delete shared.txt"
git checkout feature -q
echo "modified by feature" > shared.txt
git add . && git commit -q -m "feature: modify shared.txt"
git checkout main -q
git merge feature 2>/dev/null || true
echo "  ✓ add/delete conflict (shared.txt)"

# ── 5. Nested path conflict ───────────────────────────────────────
echo "[5/6] nested-path..."
mkdir -p "$BASE/nested-path" && cd "$BASE/nested-path"
git init -b main -q
mkdir -p src/components/ui
cat > src/components/ui/Modal.tsx << 'EOF'
export function Modal({ title }: { title: string }) {
  return <div className="modal"><h2>{title}</h2></div>;
}
EOF
git add . && git commit -q -m "init: add Modal component"
git checkout -b feature -q
cat > src/components/ui/Modal.tsx << 'EOF'
export function Modal({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="modal"><h2>{title}</h2><button onClick={onClose}>X</button></div>;
}
EOF
git add . && git commit -q -m "feature: add close button"
git checkout main -q
cat > src/components/ui/Modal.tsx << 'EOF'
export function Modal({ title, size }: { title: string; size: 'sm' | 'lg' }) {
  return <div className={`modal modal-${size}`}><h2>{title}</h2></div>;
}
EOF
git add . && git commit -q -m "main: add size prop"
git merge feature 2>/dev/null || true
echo "  ✓ nested path conflict (src/components/ui/Modal.tsx)"

# ── 6. JSON conflict ──────────────────────────────────────────────
echo "[6/6] json-conflict..."
mkdir -p "$BASE/json-conflict" && cd "$BASE/json-conflict"
git init -b main -q
cat > package.json << 'EOF'
{
  "name": "myapp",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0",
    "lodash": "^4.17.0"
  }
}
EOF
git add . && git commit -q -m "init"
git checkout -b feature -q
cat > package.json << 'EOF'
{
  "name": "myapp",
  "version": "2.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "lodash": "^4.17.21",
    "zustand": "^5.0.0"
  }
}
EOF
git add . && git commit -q -m "feature: bump deps"
git checkout main -q
cat > package.json << 'EOF'
{
  "name": "myapp",
  "version": "1.5.0",
  "dependencies": {
    "react": "^18.3.0",
    "lodash": "^4.17.21",
    "clsx": "^2.1.0"
  }
}
EOF
git add . && git commit -q -m "main: bump react, add clsx"
git merge feature 2>/dev/null || true
echo "  ✓ JSON conflict in package.json"

echo ""
echo "All 6 conflict scenarios created in $BASE/:"
for d in "$BASE"/*/; do
  name=$(basename "$d")
  conflicted=$(cd "$d" && git diff --name-only --diff-filter=U 2>/dev/null | head -3 | tr '\n' ', ')
  echo "  $name → $conflicted"
done
