/**
 * ConflictMergeView — re-export of the new MergeEditor3Way.
 *
 * The original ConflictMergeView (913 lines, contentEditable + dangerouslySetInnerHTML)
 * had four user-reported issues that could not be patched — they were structural:
 *
 *   1. No syntax highlighting of differences between OURS and THEIRS
 *      (only conflict-marker background tints were applied).
 *   2. Lines misaligned between the 3 panes (each pane had its own scroll
 *      container, and `conflictMask` was indexed by middle-pane line numbers
 *      but applied to side-pane line numbers — logical bug).
 *   3. Middle pane could not be edited: contentEditable + dangerouslySetInnerHTML
 *      fights with React reconciliation on every state update — the DOM is
 *      recreated, cursor jumps to start, undo history lost.
 *   4. Toolbar buttons replaced entire conflict blocks with no granular control,
 *      no per-hunk actions, no undo.
 *
 * The new MergeEditor3Way fixes all four structurally:
 *   1. diff3 + wordDiff integration — actual change classification.
 *   2. Single AlignedRow[] model + single scroll container + ghost rows.
 *   3. textarea + pre overlay (uncontrolled) — React never manages value,
 *      cursor stays where the user puts it.
 *   4. Per-hunk floating ConflictRegionBar + undo stack.
 *
 * External callers (e.g. ChangesPage) continue to import `ConflictMergeView`
 * from this path — no API changes.
 */
export { MergeEditor3Way as ConflictMergeView } from './merge/MergeEditor3Way';
export type { MergeEditor3WayProps as ConflictMergeViewProps } from './merge/MergeEditor3Way';
