import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tag as TagIcon, Plus, Trash, RefreshCw, Check, Pencil, ChevronDown, ChevronRight, FolderTree } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type TagInfo } from '../lib/api';
import { shortHash } from '../lib/utils';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
import { copyToClipboard } from '../lib/utils';

/** SmartGit Manual: Tag-Grouping — group tags by pattern (e.g., v1.0.0, v1.0.1 → "v1.0"). */
interface TagGroup {
  name: string;
  tags: TagInfo[];
  latest?: TagInfo;
}

function groupTagsByPattern(tags: TagInfo[]): TagGroup[] {
  const groups = new Map<string, TagInfo[]>();
  const ungrouped: TagInfo[] = [];
  // Pattern: v<major>.<minor> (e.g., v1.0, 2.5)
  const pattern = /^v?(\d+\.\d+)/;
  for (const tag of tags) {
    const match = tag.name.match(pattern);
    if (match) {
      const key = 'v' + match[1];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tag);
    } else {
      ungrouped.push(tag);
    }
  }
  const result: TagGroup[] = [];
  for (const [name, groupTags] of groups.entries()) {
    groupTags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    result.push({ name, tags: groupTags, latest: groupTags[0] });
  }
  result.sort((a, b) => (b.latest?.date || '').localeCompare(a.latest?.date || ''));
  if (ungrouped.length > 0) {
    result.push({ name: 'Other', tags: ungrouped });
  }
  return result;
}

export function TagsPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const showContextMenu = useContextMenu();
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  useEscapeKey(showDialog, () => setShowDialog(false));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [ref, setRef] = useState('HEAD');
  const [annotated, setAnnotated] = useState(true);
  // Rename state — git has no tag rename, so we create new + delete old
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // SmartGit Manual: Tag-Grouping toggle
  const [groupByPattern, setGroupByPattern] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Globally selected tag — written on click, highlighted in the list, shown
  // as a chip in the Toolbar so other tools see the same tag selection.
  const selectedTag = useSelectionStore((s) => s.selectedTag);
  // New Tag targets the commit selected in History/another tool when present.
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);

  const handleRename = async (tag: TagInfo) => {
    const newName = renameValue.trim();
    if (!newName || newName === tag.name) { setRenamingTag(null); return; }
    try {
      await useOperationLogStore.getState().logOperation(
        `Rename Tag ${tag.name} → ${newName}`,
        repo.path,
        `git tag ${newName} ${tag.hash} && git tag -d ${tag.name}`,
        async () => {
          // Create new tag pointing to the same commit.
          // tag.lightweight = true means NOT annotated; pass annotated = !lightweight.
          await api.git.createTag(repo.path, newName, undefined, tag.hash, false, !tag.lightweight);
          // Delete old tag
          await api.git.deleteTag(repo.path, tag.name);
        }
      );
      toast.success(`Tag '${tag.name}' renamed to '${newName}'`);
      setRenamingTag(null);
      await load();
    } catch (e) {
      toast.error('Failed to rename tag', String(e));
      setRenamingTag(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.tags(repo.path);
      setTags(result);
    } catch (e) {
      toast.error('Failed to load tags', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.warning('Tag name is required');
      return;
    }
    try {
      if (annotated) {
        // addAnnotatedTag returns the tag object hash (createTag is fire-and-forget)
        const tagHash = await api.git.addAnnotatedTag(repo.path, name, message, ref || undefined);
        toast.success(`Annotated tag '${name}' created${tagHash ? ` (${tagHash.slice(0, 7)})` : ''}`);
      } else {
        await api.git.createTag(repo.path, name, undefined, ref || undefined);
        toast.success(`Tag '${name}' created`);
      }
      setShowDialog(false);
      setName('');
      setMessage('');
      setRef(selectedCommitHash || 'HEAD');
      setAnnotated(true);
      await load();
    } catch (e) {
      toast.error('Failed to create tag', String(e));
    }
  };

  const handleDelete = async (tag: TagInfo) => {
    if (!(await confirmDialog({
      title: `Delete tag '${tag.name}'`,
      message: 'This permanently removes the tag reference. The tagged commit is not affected.',
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await api.git.deleteTag(repo.path, tag.name);
      toast.success(`Tag '${tag.name}' deleted`);
      await load();
    } catch (e) {
      toast.error('Failed to delete tag', String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Tags</span>
          <span className="text-2xs text-text-tertiary">{tags.length} tags</span>
        </div>
        <div className="flex items-center gap-2">
          {/* SmartGit Manual: Tag-Grouping toggle */}
          <button
            className={`icon-btn ${groupByPattern ? 'active' : ''}`}
            title="Group tags by version pattern (e.g., v1.0.0, v1.0.1 → 'v1.0')"
            onClick={() => setGroupByPattern(!groupByPattern)}
          >
            <FolderTree size={13} />
          </button>
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => {
              // Cross-tool: default the new tag's ref to the commit selected
              // in History (or any other tool) instead of blind HEAD.
              setRef(selectedCommitHash || 'HEAD');
              setShowDialog(true);
            }}
          >
            <Plus size={12} />
            New Tag
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="empty-state">
            <div className="spinner mb-3" />
            <div className="empty-state-title">Loading tags...</div>
          </div>
        ) : tags.length === 0 ? (
          <div className="empty-state">
            <TagIcon size={48} className="empty-state-icon" />
            <div className="empty-state-title">No tags yet</div>
            <div className="empty-state-desc">
              Tags mark specific commits — useful for releases, milestones, or
              important checkpoints. Click "New Tag" above to create one.
            </div>
          </div>
        ) : groupByPattern ? (
          // SmartGit Manual: Tag-Grouping display — groups tags by pattern
          (() => {
            const groups = useMemo(() => groupTagsByPattern(tags), [tags]);
            return (
              <>
                {groups.map((group) => {
                  const collapsed = collapsedGroups.has(group.name);
                  return (
                    <div key={group.name}>
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary border-b border-border-default cursor-pointer hover:bg-bg-hover text-xs font-semibold text-text-primary"
                        onClick={() => {
                          const next = new Set(collapsedGroups);
                          if (collapsed) next.delete(group.name);
                          else next.add(group.name);
                          setCollapsedGroups(next);
                        }}
                      >
                        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                        <span>{group.name}</span>
                        <span className="text-2xs text-text-tertiary font-normal">({group.tags.length} tags)</span>
                        {group.latest && (
                          <span className="text-2xs text-text-tertiary ml-auto font-mono">
                            latest: {group.latest.name}
                          </span>
                        )}
                      </div>
                      {!collapsed && group.tags.map((t) => (
                        <TagRow
                          key={t.name}
                          tag={t}
                          renamingTag={renamingTag}
                          renameValue={renameValue}
                          setRenameValue={setRenameValue}
                          setRenamingTag={setRenamingTag}
                          handleRename={handleRename}
                          handleDelete={handleDelete}
                          showContextMenu={showContextMenu}
                          selected={selectedTag === t.name}
                        />
                      ))}
                    </div>
                  );
                })}
              </>
            );
          })()
        ) : (
          <>
            {tags.length > 200 && (
              <div className="px-3 py-1 text-2xs text-text-tertiary border-b border-border-subtle">
                Showing first 200 of {tags.length} tags
              </div>
            )}
            {tags.slice(0, 200).map((t) => (
              <TagRow
                key={t.name}
                tag={t}
                renamingTag={renamingTag}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                setRenamingTag={setRenamingTag}
                handleRename={handleRename}
                handleDelete={handleDelete}
                showContextMenu={showContextMenu}
                selected={selectedTag === t.name}
              />
            ))
            }
          </>
        )}
      </div>

      {showDialog && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowDialog(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">New Tag</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Name</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="v1.0.0"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Reference</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="HEAD, branch name, or commit hash"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={annotated}
                  onChange={(e) => setAnnotated(e.target.checked)}
                />
                Annotated tag
              </label>
              {annotated && (
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">Message</label>
                  <textarea
                    className="w-full text-sm h-20 resize-none"
                    placeholder="Release v1.0.0"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Check size={13} />
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tag row — used in both flat and grouped display. */
function TagRow({
  tag: t,
  renamingTag,
  renameValue,
  setRenameValue,
  setRenamingTag,
  handleRename,
  handleDelete,
  showContextMenu,
  selected,
}: {
  tag: TagInfo;
  renamingTag: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  setRenamingTag: (v: string | null) => void;
  handleRename: (tag: TagInfo) => void;
  handleDelete: (tag: TagInfo) => void;
  showContextMenu: ReturnType<typeof useContextMenu>;
  /** Whether this tag is the globally selected tag (Toolbar chip / other tools see it too). */
  selected: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer ${selected ? 'bg-accent/10 border-l-2 border-l-accent' : ''}`}
      onClick={() => {
        // Cross-tool selection: the tag name AND its commit become global —
        // Toolbar shows the tag chip, History opens the tagged commit.
        useSelectionStore.getState().selectTag(t.name);
        useSelectionStore.getState().selectCommit(t.hash);
        window.location.hash = '#/history';
      }}
      title="Click to select this tag and view its commit in History"
      onContextMenu={(e) => {
        e.preventDefault();
        showContextMenu([
          { label: 'Copy Name', clickId: 'copy-name' },
          { label: 'Copy Hash', clickId: 'copy-hash' },
          { type: 'separator' },
          { label: `Rename '${t.name}'...`, clickId: 'rename' },
          { label: `Delete Tag '${t.name}'...`, clickId: 'delete' },
          { type: 'separator' },
          { label: 'View Commit in History', clickId: 'view-commit' },
        ], (action) => {
          switch (action) {
            case 'copy-name': copyToClipboard(t.name); break;
            case 'copy-hash': copyToClipboard(t.hash); break;
            case 'rename': setRenamingTag(t.name); setRenameValue(t.name); break;
            case 'delete': handleDelete(t); break;
            case 'view-commit':
              useSelectionStore.getState().selectTag(t.name);
              useSelectionStore.getState().selectCommit(t.hash);
              window.location.hash = '#/history';
              break;
          }
        });
      }}
    >
      <TagIcon size={14} className="text-status-modified flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {renamingTag === t.name ? (
            <input
              type="text"
              className="text-xs w-32 px-1 py-0.5"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(t);
                if (e.key === 'Escape') setRenamingTag(null);
              }}
              onBlur={() => handleRename(t)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-text-primary">{t.name}</span>
          )}
          {!t.lightweight && (
            <span className="badge badge-modified">ANNOTATED</span>
          )}
        </div>
        {t.annotation && (
          <div className="text-xs text-text-secondary truncate mt-0.5">
            {t.annotation}
          </div>
        )}
        <div className="text-xs text-text-tertiary mt-0.5">
          <CommitHashLink hash={t.hash} />
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
        <button
          className="icon-btn !w-6 !h-6"
          title="Rename"
          onClick={(e) => { e.stopPropagation(); setRenamingTag(t.name); setRenameValue(t.name); }}
        >
          <Pencil size={12} />
        </button>
        <button
          className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
          title="Delete"
          onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
        >
          <Trash size={12} />
        </button>
      </div>
    </div>
  );
}
