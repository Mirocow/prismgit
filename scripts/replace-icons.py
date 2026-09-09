#!/usr/bin/env python3
"""Replace lucide-react imports with our local icons module."""
import re
import os
import sys

# Mapping: lucide name -> our name
MAPPING = {
    'GitBranch': 'GitBranch',
    'GitCommit': 'GitCommit',
    'GitPullRequest': 'GitPullRequest',
    'GitPullRequestArrow': 'GitPullRequest',
    'GitMerge': 'GitMerge',
    'GitClone': 'Download',
    'GitBranchPlus': 'Plus',
    'History': 'History',
    'Tag': 'Tag',
    'Package': 'Package',
    'FolderTree': 'FolderTree',
    'RotateCcw': 'RotateCcw',
    'RefreshCw': 'RefreshCw',
    'RefreshCcw': 'Sync',
    'Plus': 'Plus',
    'Minus': 'Minus',
    'Trash2': 'Trash',
    'ChevronDown': 'ChevronDown',
    'ChevronRight': 'ChevronRight',
    'Search': 'Search',
    'Copy': 'Copy',
    'Folder': 'Folder',
    'FolderPlus': 'FolderPlus',
    'FolderGit2': 'FolderGit',
    'Pin': 'Pin',
    'PinOff': 'PinOff',
    'X': 'X',
    'Settings': 'Settings',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'CloudDownload': 'CloudDownload',
    'ExternalLink': 'ExternalLink',
    'Pencil': 'Pencil',
    'Check': 'Check',
    'CheckCircle': 'CheckCircle',
    'AlertCircle': 'AlertCircle',
    'AlertTriangle': 'AlertTriangle',
    'Info': 'Info',
    'Loader': 'Loader',
    'EyeOff': 'EyeOff',
    'Edit2': 'Edit',
    'Edit': 'Edit',
    'Upload': 'Upload',
    'Download': 'Download',
    'CornerDownRight': 'CornerDownRight',
    'FileText': 'FileText',
    'Undo2': 'Undo',
    'Github': 'Github',
    'LogOut': 'LogOut',
    'Sun': 'Sun',
    'Moon': 'Moon',
    'BookOpen': 'BookOpen',
    'CherryPick': 'GitPullRequest',  # alias replacement
}

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match: import { Icon1, Icon2 as Alias } from 'lucide-react'
    # Also match multi-line imports
    pattern = re.compile(
        r"import\s*\{([^}]+)\}\s*from\s*['\"]lucide-react['\"]\s*;?",
        re.DOTALL
    )

    matches = list(pattern.finditer(content))
    if not matches:
        return False

    for m in matches:
        import_block = m.group(1)
        # Parse names: split by comma, handle "Name as Alias"
        names = []
        for part in import_block.split(','):
            part = part.strip()
            if not part:
                continue
            # Handle "Name as Alias"
            if ' as ' in part:
                orig, alias = [p.strip() for p in part.split(' as ', 1)]
                names.append((orig, alias))
            else:
                names.append((part, None))

        # Build new imports
        new_names = []
        for orig, alias in names:
            # Special case: "Settings as SettingsIcon"
            if orig == 'Settings' and alias == 'SettingsIcon':
                new_names.append('Settings as SettingsIcon')
                continue
            # Special case: "Tag as TagIcon"
            if orig == 'Tag' and alias == 'TagIcon':
                new_names.append('Tag as TagIcon')
                continue
            new_name = MAPPING.get(orig, orig)
            if alias:
                new_names.append(f'{new_name} as {alias}')
            else:
                new_names.append(new_name)

        new_import = f"import {{ {', '.join(new_names)} }} from '../components/icons';"
        # For pages/, path is ../components/icons
        # For components/, path is ./icons
        if '/pages/' in filepath or filepath.startswith('src/pages/'):
            new_import = f"import {{ {', '.join(new_names)} }} from '../components/icons';"
        else:
            new_import = f"import {{ {', '.join(new_names)} }} from './icons';"

        content = content[:m.start()] + new_import + content[m.end():]

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    return True


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
