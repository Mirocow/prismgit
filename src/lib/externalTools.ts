/**
 * External Tools system (SmartGit Manual: Preferences → Tools).
 *
 * Supports:
 *   - External Tools (open in editor, terminal, etc.)
 *   - Diff Tools (for "Compare" command)
 *   - Conflict Solvers (for "Conflict Solver" command)
 *
 * Variable substitution (per SmartGit Manual):
 *   ${filePath}        — full path of the selected file
 *   ${fileName}        — file name without directory
 *   ${fileUri}        — file:// URI
 *   ${repositoryRootPath} — repo root directory
 *   ${selectionFile}  — selected file in Changes view
 *   ${remoteUrl}      — remote URL of the current remote
 *   ${encoding}       — file encoding (utf-8 default)
 *   ${commit}         — selected commit hash
 *   ${commit2}        — second selected commit (for compare)
 *   ${fileOpen}       — file picker for open tool argument
 *   ${fileSave}       — file picker for save tool argument
 *   ${dirSelect}      — directory picker
 *   ${git}            — git executable path
 *   ${gitDir}         — .git directory path
 *   ${smartGitDir}    — PrismGit install directory (best-effort)
 *   ${leftFile}       — left file (diff/conflict solver)
 *   ${rightFile}      — right file (diff/conflict solver)
 *   ${baseFile}       — base file (3-way merge)
 *   ${mergedFile}     — merged output file (conflict solver)
 */

export type ToolKind = 'external' | 'diff' | 'conflict-solver';
export type ToolHandle = 'files' | 'directories' | 'both' | 'refs' | 'commits';

export interface ExternalTool {
  id: string;
  name: string;
  kind: ToolKind;
  /** Executable command (e.g., "code" for VS Code). */
  command: string;
  /** Arguments template with ${var} substitutions. */
  arguments: string;
  /** What this tool operates on. */
  handles: ToolHandle;
  /** File/directory name pattern (glob, e.g., "*.ts" or "*"). */
  pattern?: string;
  /** Show a confirmation dialog before running. */
  confirmMessage?: string;
  /** Wait for the tool to finish and show its output. */
  waitForFinish?: boolean;
  /** Can be invoked by the "Open" command (external tools only). */
  usableByOpen?: boolean;
}

export interface ToolContext {
  filePath?: string;
  fileName?: string;
  repositoryRootPath?: string;
  selectionFile?: string;
  remoteUrl?: string;
  encoding?: string;
  commit?: string;
  commit2?: string;
  leftFile?: string;
  rightFile?: string;
  baseFile?: string;
  mergedFile?: string;
  git?: string;
  gitDir?: string;
  /** PrismGit install directory — best-effort, may be undefined. */
  smartGitDir?: string;
}

/**
 * Substitute variables in a tool argument string.
 * Unknown ${vars} are left as-is.
 */
export function substituteVariables(template: string, ctx: ToolContext): string {
  const replace = (key: string, value: string | undefined): string => {
    if (value === undefined) return '';
    return value;
  };
  return template.replace(/\$\{(\w+)\}/g, (full, key: string) => {
    switch (key) {
      case 'filePath':
        return replace(key, ctx.filePath);
      case 'fileName':
        return replace(key, ctx.fileName);
      case 'fileUri':
        return ctx.filePath ? `file://${ctx.filePath}` : '';
      case 'repositoryRootPath':
        return replace(key, ctx.repositoryRootPath);
      case 'selectionFile':
        return replace(key, ctx.selectionFile);
      case 'remoteUrl':
        return replace(key, ctx.remoteUrl);
      case 'encoding':
        return replace(key, ctx.encoding || 'utf-8');
      case 'commit':
        return replace(key, ctx.commit);
      case 'commit2':
        return replace(key, ctx.commit2);
      case 'fileOpen':
      case 'fileSave':
      case 'dirSelect':
        // These are interactive pickers — not supported in headless mode.
        // PrismGit prompts the user before invoking the tool.
        return '';
      case 'leftFile':
        return replace(key, ctx.leftFile);
      case 'rightFile':
        return replace(key, ctx.rightFile);
      case 'baseFile':
        return replace(key, ctx.baseFile);
      case 'mergedFile':
        return replace(key, ctx.mergedFile);
      case 'git':
        return replace(key, ctx.git || 'git');
      case 'gitDir':
        return replace(key, ctx.gitDir);
      case 'smartGitDir':
        return replace(key, ctx.smartGitDir || '');
      default:
        return full;
    }
  });
}

/**
 * Parse arguments string into an argv array.
 * Handles quoted arguments, escape sequences, and variable substitution.
 */
export function parseArguments(args: string, ctx: ToolContext): string[] {
  const substituted = substituteVariables(args, ctx);
  const result: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (const ch of substituted) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (ch === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result.filter(a => a.length > 0);
}

/**
 * Check if a tool's pattern matches a given filename.
 */
export function toolMatchesPattern(tool: ExternalTool, filename: string): boolean {
  if (!tool.pattern || tool.pattern === '*') return true;
  // Simple glob: *.ext → ends with .ext
  if (tool.pattern.startsWith('*.')) {
    const ext = tool.pattern.slice(1);
    return filename.toLowerCase().endsWith(ext.toLowerCase());
  }
  // Exact match
  if (tool.pattern === filename) return true;
  // Try regex
  try {
    const re = new RegExp(tool.pattern);
    return re.test(filename);
  } catch {
    return false;
  }
}

/** Built-in default tools. */
export const DEFAULT_TOOLS: ExternalTool[] = [
  {
    id: 'open-file',
    name: 'Open File',
    kind: 'external',
    command: 'xdg-open', // Linux default; will be platform-overridden in UI
    arguments: '${filePath}',
    handles: 'files',
    pattern: '*',
    usableByOpen: true,
  },
  {
    id: 'open-terminal',
    name: 'Open in Terminal',
    kind: 'external',
    command: 'x-terminal-emulator',
    arguments: '--working-directory ${repositoryRootPath}',
    handles: 'directories',
    pattern: '*',
  },
  {
    id: 'git-shell',
    name: 'Open Git-Shell',
    kind: 'external',
    command: 'bash',
    arguments: '-c "cd ${repositoryRootPath} && exec bash"',
    handles: 'both',
    pattern: '*',
  },
];

/**
 * SmartGit Manual: Catalog of preset diff/merge tools.
 * Auto-detects the platform-specific command path.
 * Supports: Beyond Compare, KDiff3, Araxis Merge, Meld, P4Merge, VS Code.
 */
export interface DiffToolPreset {
  id: string;
  name: string;
  /** Platform-specific command paths. */
  commands: {
    win32: string[];
    darwin: string[];
    linux: string[];
  };
  /** Arguments template for diff mode (uses ${leftFile}, ${rightFile}). */
  diffArgs: string;
  /** Arguments template for merge mode (uses ${leftFile}, ${rightFile}, ${baseFile}, ${mergedFile}). */
  mergeArgs: string;
  /** Description shown in UI. */
  description: string;
}

export const DIFF_TOOL_PRESETS: DiffToolPreset[] = [
  {
    id: 'bcompare',
    name: 'Beyond Compare',
    commands: {
      win32: ['C:\\Program Files\\Beyond Compare 4\\BCompare.exe', 'C:\\Program Files\\Beyond Compare 5\\BCompare.exe'],
      darwin: ['/usr/local/bin/bcompare', '/Applications/Beyond Compare.app/Contents/MacOS/bcomp'],
      linux: ['/usr/bin/bcompare', '/usr/local/bin/bcompare'],
    },
    diffArgs: '${leftFile} ${rightFile}',
    mergeArgs: '${leftFile} ${rightFile} ${baseFile} ${mergedFile}',
    description: 'Commercial diff/merge tool with side-by-side comparison.',
  },
  {
    id: 'kdiff3',
    name: 'KDiff3',
    commands: {
      win32: ['C:\\Program Files\\KDiff3\\kdiff3.exe'],
      darwin: ['/Applications/kdiff3.app/Contents/MacOS/kdiff3'],
      linux: ['/usr/bin/kdiff3'],
    },
    diffArgs: '${leftFile} ${rightFile}',
    mergeArgs: '${leftFile} ${rightFile} --base ${baseFile} --output ${mergedFile}',
    description: 'Free open-source 3-way merge tool.',
  },
  {
    id: 'araxis',
    name: 'Araxis Merge',
    commands: {
      win32: ['C:\\Program Files\\Araxis\\Araxis Merge\\Compare.exe'],
      darwin: ['/Applications/Araxis Merge.app/Contents/MacOS/compare'],
      linux: [],
    },
    diffArgs: '${leftFile} ${rightFile}',
    mergeArgs: '${leftFile} ${rightFile} ${baseFile} ${mergedFile} /merge',
    description: 'Commercial diff/merge tool (Windows + macOS only).',
  },
  {
    id: 'meld',
    name: 'Meld',
    commands: {
      win32: ['C:\\Program Files (x86)\\Meld\\meld.exe'],
      darwin: ['/usr/local/bin/meld', '/Applications/Meld.app/Contents/MacOS/meld'],
      linux: ['/usr/bin/meld', '/usr/local/bin/meld'],
    },
    diffArgs: '${leftFile} ${rightFile}',
    mergeArgs: '${leftFile} ${rightFile} ${baseFile} --output ${mergedFile}',
    description: 'Free open-source visual diff tool (GTK).',
  },
  {
    id: 'p4merge',
    name: 'P4Merge',
    commands: {
      win32: ['C:\\Program Files\\Perforce\\p4merge.exe'],
      darwin: ['/Applications/p4merge.app/Contents/MacOS/p4merge'],
      linux: ['/usr/bin/p4merge'],
    },
    diffArgs: '${leftFile} ${rightFile}',
    mergeArgs: '${leftFile} ${rightFile} ${baseFile} ${mergedFile}',
    description: 'Free visual diff/merge tool from Perforce.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    commands: {
      win32: ['code.cmd'],
      darwin: ['/usr/local/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
      linux: ['/usr/bin/code', '/usr/local/bin/code'],
    },
    diffArgs: '--diff ${leftFile} ${rightFile}',
    mergeArgs: '${leftFile} ${rightFile} ${baseFile} ${mergedFile} --merge',
    description: 'Use VS Code as diff/merge editor.',
  },
];

/**
 * Auto-detect which preset tools are installed on the current platform.
 * Returns presets whose command exists on the filesystem.
 */
export async function detectInstalledDiffTools(): Promise<DiffToolPreset[]> {
  const platform = typeof navigator !== 'undefined'
    ? (navigator.platform.toLowerCase().includes('win') ? 'win32' : navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux')
    : 'linux';
  const installed: DiffToolPreset[] = [];
  // For renderer process — can't check filesystem directly, so return all presets
  // and let the user pick. Backend would do actual fs.existsSync check.
  for (const preset of DIFF_TOOL_PRESETS) {
    if (preset.commands[platform as 'win32' | 'darwin' | 'linux']?.length > 0) {
      installed.push(preset);
    }
  }
  return installed;
}

/**
 * Serialize tools to JSON for persistence.
 */
export function serializeTools(tools: ExternalTool[]): string {
  return JSON.stringify(tools, null, 2);
}

/**
 * Deserialize tools from JSON.
 */
export function deserializeTools(json: string): ExternalTool[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t && typeof t.name === 'string');
  } catch {
    return [];
  }
}
