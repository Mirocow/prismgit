/**
 * Overlap column — visualization of related commits (SmartGit 24 feature)
 * Detects commits that touch the same files as the selected commit.
 */

import type { LogEntry, CommitFile } from './api';

export interface OverlapInfo {
  commitHash: string;
  overlapCount: number;
  overlapFiles: string[];
  relatedCommits: { hash: string; subject: string; sharedFiles: string[] }[];
}

/**
 * Compute overlap between commits based on files they touch.
 * Returns a map of commit hash → overlap info.
 */
export function computeOverlap(
  commits: LogEntry[],
  commitFilesMap: Map<string, CommitFile[]>
): Map<string, OverlapInfo> {
  const result = new Map<string, OverlapInfo>();

  // Build a reverse index: file → list of commits that touch it
  const fileToCommits = new Map<string, string[]>();
  for (const commit of commits) {
    const files = commitFilesMap.get(commit.hash) || [];
    for (const file of files) {
      const existing = fileToCommits.get(file.path) || [];
      existing.push(commit.hash);
      fileToCommits.set(file.path, existing);
    }
  }

  // For each commit, find related commits
  for (const commit of commits) {
    const files = commitFilesMap.get(commit.hash) || [];
    const filePaths = files.map(f => f.path);
    const relatedMap = new Map<string, string[]>(); // relatedHash → shared files

    for (const filePath of filePaths) {
      const commitsForFile = fileToCommits.get(filePath) || [];
      for (const otherHash of commitsForFile) {
        if (otherHash === commit.hash) continue;
        const shared = relatedMap.get(otherHash) || [];
        shared.push(filePath);
        relatedMap.set(otherHash, shared);
      }
    }

    const relatedCommits = Array.from(relatedMap.entries())
      .map(([hash, sharedFiles]) => {
        const relatedCommit = commits.find(c => c.hash === hash);
        return {
          hash,
          subject: relatedCommit?.subject || '',
          sharedFiles,
        };
      })
      .filter(r => r.subject) // only include if we found the commit
      .sort((a, b) => b.sharedFiles.length - a.sharedFiles.length);

    result.set(commit.hash, {
      commitHash: commit.hash,
      overlapCount: relatedCommits.length,
      overlapFiles: filePaths,
      relatedCommits,
    });
  }

  return result;
}

/**
 * Get a simple overlap score for a commit (0-100).
 * Higher means more overlap with other commits.
 */
export function getOverlapScore(info: OverlapInfo | undefined): number {
  if (!info || info.overlapCount === 0) return 0;
  // Cap at 100
  return Math.min(100, info.overlapCount * 10);
}

/**
 * Get color for overlap visualization.
 */
export function getOverlapColor(score: number): string {
  if (score === 0) return 'var(--text-tertiary)';
  if (score < 30) return 'var(--status-added)';
  if (score < 60) return 'var(--status-modified)';
  return 'var(--status-deleted)';
}
