#!/usr/bin/env python3
"""Replace icon usages in source code (e.g. <Trash2 .../> -> <Trash .../>)."""
import re
import os
import sys

# Old name -> new name
REPLACEMENTS = {
    'GitBranchPlus': 'Plus',
    'FolderGit2': 'FolderGit',
    'GitPullRequestArrow': 'GitPullRequest',
    'RefreshCcw': 'Sync',
    'Trash2': 'Trash',
    'Edit2': 'Edit',
    'Undo2': 'Undo',
    'CherryPick': 'GitPullRequest',
    'FolderOpen': 'Folder',
    'Archive': 'Package',
    'GitClone': 'Download',
}

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    for old, new in REPLACEMENTS.items():
        # Match as JSX component: <OldName or </OldName> or OldName(
        content = re.sub(r'\b' + old + r'\b', new, content)

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else 'src'
    count = 0
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.tsx') or f.endswith('.ts'):
                filepath = os.path.join(root, f)
                if process_file(filepath):
                    count += 1
                    print(f'Updated: {filepath}')
    print(f'\nTotal: {count} files updated')


if __name__ == '__main__':
    main()
