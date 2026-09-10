/**
 * Renderer-facing API of the VSCode integration.
 */
export interface VsCodeDetection {
  available: boolean;
  source: 'custom' | 'platform' | 'path' | 'none';
  path: string;
  version: string;
}

export interface VsCodeOpenResult {
  ok: boolean;
  via: 'cli' | 'uri' | 'none';
}

export interface VsCodeOperationResult {
  ok: boolean;
  detail?: string;
}

export interface VsCodeDiffToolStatus {
  diffTool: string;
  mergeTool: string;
  vscodeConfigured: boolean;
}

export interface VsCodeApi {
  /** Detect the VS Code CLI (platform paths + PATH). `force` re-runs detection. */
  detect: (force?: boolean) => Promise<VsCodeDetection>;
  /** Open a repo folder (or file, optionally at a line) in VS Code. */
  open: (repoPath: string, target?: { file?: string; line?: number }) => Promise<VsCodeOpenResult>;
  /** Open `code --diff` of the file's HEAD version vs the working tree. */
  openFileDiff: (repoPath: string, file: string) => Promise<VsCodeOperationResult>;
  /** Open the three-way merge editor for a conflicted file. */
  openMerge: (repoPath: string, file: string) => Promise<VsCodeOperationResult>;
  /** Open the file AS OF a commit (blob materialized to a temp copy). */
  openFileVersion: (repoPath: string, sha: string, file: string) => Promise<VsCodeOperationResult>;
  /** Open `code --diff` of the file between the commit's parent and the commit. */
  openCommitFileDiff: (repoPath: string, sha: string, file: string) => Promise<VsCodeOperationResult>;
  /** Open the full commit patch (`git show`) as a highlighted .patch file. */
  openCommitPatch: (repoPath: string, sha: string) => Promise<VsCodeOperationResult>;
  /** Open a set of folders as a multi-root `.code-workspace` in VS Code. */
  openWorkspace: (name: string, folderPaths: string[]) => Promise<VsCodeOperationResult>;
  /** Read the repo's local diff.tool / merge.tool configuration. */
  diffToolStatus: (repoPath: string) => Promise<VsCodeDiffToolStatus>;
  /** Register VS Code as the repo's git difftool AND mergetool (local config). */
  installDiffTool: (repoPath: string) => Promise<VsCodeOperationResult>;
  /** Remove the VS Code difftool/mergetool registration (local config). */
  removeDiffTool: (repoPath: string) => Promise<VsCodeOperationResult>;
}
