/**
 * Distributed Reviews — offline code review system (SmartGit add-on)
 * Stores review comments in git notes (refs/notes/reviews)
 * so they are versioned with the repository and can be shared.
 */

import { api } from './api';

export interface ReviewComment {
  id: string;
  commitHash: string;
  filePath: string;
  lineNumber: number;
  author: string;
  date: string;
  body: string;
  severity: 'info' | 'suggestion' | 'warning' | 'critical';
  resolved: boolean;
}

export interface Review {
  commitHash: string;
  comments: ReviewComment[];
}

const NOTES_REF = 'refs/notes/reviews';

/**
 * Load all reviews from git notes.
 * Reviews are stored as JSON in the note body.
 */
export async function loadReviews(repoPath: string): Promise<Review[]> {
  try {
    // List all notes
    const notesRaw = await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'list']);
    const lines = notesRaw.split('\n').filter(Boolean);
    const reviews: Review[] = [];

    for (const line of lines) {
      const [noteHash, commitHash] = line.split(' ');
      if (!commitHash) continue;
      try {
        const noteBody = await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'show', commitHash]);
        const comments = JSON.parse(noteBody) as ReviewComment[];
        reviews.push({ commitHash, comments });
      } catch {
        // Not valid JSON, skip
      }
    }

    return reviews;
  } catch {
    return [];
  }
}

/**
 * Load reviews for a specific commit.
 */
export async function loadReviewsForCommit(repoPath: string, commitHash: string): Promise<ReviewComment[]> {
  try {
    const noteBody = await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'show', commitHash]);
    return JSON.parse(noteBody) as ReviewComment[];
  } catch {
    return [];
  }
}

/**
 * Add a review comment to a commit.
 */
export async function addReviewComment(
  repoPath: string,
  comment: Omit<ReviewComment, 'id' | 'date'>
): Promise<ReviewComment> {
  const newComment: ReviewComment = {
    ...comment,
    id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    date: new Date().toISOString(),
    resolved: false,
  };

  // Load existing comments
  const existing = await loadReviewsForCommit(repoPath, comment.commitHash);
  const updated = [...existing, newComment];

  // Save back to git notes
  const json = JSON.stringify(updated, null, 2);
  await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'add', '-f', '-m', json, comment.commitHash]);

  return newComment;
}

/**
 * Update a review comment.
 */
export async function updateReviewComment(
  repoPath: string,
  commitHash: string,
  commentId: string,
  updates: Partial<ReviewComment>
): Promise<void> {
  const existing = await loadReviewsForCommit(repoPath, commitHash);
  const updated = existing.map(c =>
    c.id === commentId ? { ...c, ...updates } : c
  );
  const json = JSON.stringify(updated, null, 2);
  await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'add', '-f', '-m', json, commitHash]);
}

/**
 * Delete a review comment.
 */
export async function deleteReviewComment(
  repoPath: string,
  commitHash: string,
  commentId: string
): Promise<void> {
  const existing = await loadReviewsForCommit(repoPath, commitHash);
  const updated = existing.filter(c => c.id !== commentId);
  if (updated.length === 0) {
    await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'remove', commitHash]).catch(() => {});
  } else {
    const json = JSON.stringify(updated, null, 2);
    await api.git.raw(repoPath, ['notes', '--ref', NOTES_REF, 'add', '-f', '-m', json, commitHash]);
  }
}

/**
 * Mark a comment as resolved or unresolved.
 */
export async function setCommentResolved(
  repoPath: string,
  commitHash: string,
  commentId: string,
  resolved: boolean
): Promise<void> {
  await updateReviewComment(repoPath, commitHash, commentId, { resolved });
}

/**
 * Push reviews to remote so they can be shared with team.
 *
 * Handles the two common failure cases gracefully:
 *  - 'src refspec does not match any' — the local repo has no reviews yet
 *    (refs/notes/reviews doesn't exist). We check first with rev-parse;
 *    if the ref is missing, we return 'nothing-to-push' instead of erroring.
 *  - Network/auth errors — re-thrown so the caller can show a toast.
 *
 * Returns: 'pushed' | 'nothing-to-push'
 */
export async function pushReviews(
  repoPath: string,
  remote = 'origin'
): Promise<'pushed' | 'nothing-to-push'> {
  // Check if the local notes ref exists. If not, there's nothing to push.
  try {
    await api.git.raw(repoPath, ['rev-parse', '--verify', '-q', NOTES_REF]);
  } catch {
    // Local ref doesn't exist — no reviews have been added yet.
    return 'nothing-to-push';
  }
  await api.git.raw(repoPath, ['push', remote, NOTES_REF]);
  return 'pushed';
}

/**
 * Fetch reviews from remote.
 *
 * Handles 'couldn't find remote ref refs/notes/reviews' gracefully — that
 * just means the remote has no reviews yet (the ref was never pushed).
 * We treat it as 'no reviews on remote' rather than an error.
 *
 * Returns: 'fetched' | 'no-remote-reviews'
 */
export async function fetchReviews(
  repoPath: string,
  remote = 'origin'
): Promise<'fetched' | 'no-remote-reviews'> {
  try {
    // Use refspec form so the fetched notes land in the right local ref.
    // Without ':refs/notes/reviews', git would fetch into FETCH_HEAD only.
    await api.git.raw(repoPath, ['fetch', remote, `${NOTES_REF}:${NOTES_REF}`]);
    return 'fetched';
  } catch (e) {
    const msg = String(e);
    // 'couldn't find remote ref' = remote has no reviews ref yet.
    // This is NOT an error — it's the normal state for a repo that has
    // never had reviews pushed to it.
    if (msg.includes("couldn't find remote ref") || msg.includes('no such remote ref')) {
      return 'no-remote-reviews';
    }
    // Real network/auth error — re-throw so the caller shows a toast.
    throw e;
  }
}
