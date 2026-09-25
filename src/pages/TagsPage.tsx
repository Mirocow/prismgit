import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Tag as TagIcon, Plus, Trash, RefreshCw, Check, Pencil, ChevronDown, ChevronRight, FolderTree, GitBranch } from '../components/icons';
import { EmptyState } from '../components/EmptyState';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { useGitStore } from '../stores/gitStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type TagInfo } from '../lib/api';
import { copyToClipboard, shortHash } from '../lib/utils';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
import { useI18n, t as standaloneT } from '../lib/i18n';

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
    // Module-scope helper — use the standalone t() (call-time locale read)
    result.push({ name: standaloneT('tags.otherGroup'), tags: ungrouped });
  }
  return result;
}

export function TagsPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const { t } = useI18n();
  const showContextMenu = useContextMenu();
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  useEscapeKey(showDialog, () => setShowDialog(false));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [ref, setRef] = useState('HEAD');
  const [annotated, setAnnotated] = useState(true);
  // Tag EDIT dialog — full edit: rename AND message change. git has no tag
  // mutation, so "edit" re-creates the tag at the same commit and (when the
  // name changed) deletes the old name. The previous inline rename-only
  // input silently DESTROYED the annotation + message of annotated tags
  // (createTag was called without the message → lightweight tag).
  const [editTag, setEditTag] = useState<TagInfo | null>(null);
  const [editName, setEditName] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editAnnotated, setEditAnnotated] = useState(true);
  const [editBusy, setEditBusy] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  // SmartGit Manual: Tag-Grouping toggle
  const [groupByPattern, setGroupByPattern] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // "Show all" past the initial 200-row page — the OLD code silently hid
  // every tag after #200 (same class of bug as the branch list).
  const [showAll, setShowAll] = useState(false);
  // Globally selected tag — written on click, highlighted in the list, shown
  // as a chip in the Toolbar so other tools see the same tag selection.
  const selectedTag = useSelectionStore((s) => s.selectedTag);
  // New Tag targets the commit selected in History/another tool when present.
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);

  /** Open the tag EDIT dialog — fetches the FULL message via tagShow
   *  (tags() only returns the subject; prefilling from it would truncate
   *  multi-line messages and the save would destroy the tail).
   *  Token-guarded: if the user opens another tag (or closes the dialog)
   *  while the fetch is in flight, the stale result is discarded. */
  const editFetchToken = useRef(0);
  const openEditTag = async (tag: TagInfo) => {
    const token = ++editFetchToken.current;
    setEditTag(tag);
    setEditName(tag.name);
    setEditMessage(tag.annotation ?? '');
    setEditAnnotated(!tag.lightweight);
    setEditLoading(true);
    try {
      const full = await api.git.tagShow(repo.path, tag.name);
      if (editFetchToken.current === token && full) {
        setEditMessage(full.message);
        setEditAnnotated(full.annotated);
      }
    } catch { /* keep the tags()-derived prefill */ } finally {
      if (editFetchToken.current === token) setEditLoading(false);
    }
  };

  const closeEditTag = () => {
    editFetchToken.current++; // invalidate any in-flight tagShow prefill
    setEditTag(null);
  };
  useEscapeKey(!!editTag, closeEditTag);

  const handleSaveEdit = async () => {
    if (!editTag || !editName.trim()) return;
    const oldTag = editTag;
    const newName = editName.trim();
    const renamed = newName !== oldTag.name;
    setEditBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(
        renamed ? `Rename Tag ${oldTag.name} → ${newName}` : `Edit Tag ${oldTag.name}`,
        repo.path,
        renamed
          ? `git tag ${editAnnotated ? '-a ' : ''}${newName} ${oldTag.hash} && git tag -d ${oldTag.name}`
          : `git tag -f ${editAnnotated ? '-a ' : ''}${newName} ${oldTag.hash}`,
        async () => {
          if (renamed) {
            // Rename: create the NEW tag at the same commit (annotation +
            // message preserved), then delete the OLD name.
            await api.git.createTag(repo.path, newName, editMessage || undefined, oldTag.hash, false, editAnnotated);
            await api.git.deleteTag(repo.path, oldTag.name);
          } else {
            // Same name: force re-create so the new message/annotation sticks.
            await api.git.createTag(repo.path, newName, editMessage || undefined, oldTag.hash, true, editAnnotated);
          }
        }
      );
      toast.success(
        renamed ? t('tags.renamed', { old: oldTag.name, new: newName }) : t('tags.updated', { name: newName }),
      );
      setEditTag(null);
      await load();
    } catch (e) {
      toast.error(t('tags.editFailed'), String(e));
    } finally {
      setEditBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.tags(repo.path);
      setTags(result);
    } catch (e) {
      toast.error(t('tags.loadFailed'), String(e));
    } finally {
      setLoading(false);
    }
    // NOTE: `t` is intentionally excluded from deps — `useI18n()` returns a
    // new function reference on every locale change but the actual t() call
    // reads the active locale at CALL time, so we don't need to re-create
    // load() when the locale changes. Excluding `t` avoids an infinite
    // re-render loop: load() → t in deps → new function → load() again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, toast]);

  // SmartGit Manual: Tag-Grouping — precompute groups whenever tags or the
  // toggle change. NOTE: previously this useMemo lived INSIDE the render IIFE
  // (a hooks violation that React 18 silently mishandles, occasionally
  // re-running on every render even when tags didn't change — perceived as
  // "Tags tool opens slowly" on repos with many tags). Hoisting to the
  // component top level fixes both the violation AND the perf issue.
  const tagGroups = useMemo(
    () => groupByPattern ? groupTagsByPattern(tags) : [],
    [groupByPattern, tags],
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.warning(t('tags.nameRequired'));
      return;
    }
    try {
      if (annotated) {
        // addAnnotatedTag returns the tag object hash (createTag is fire-and-forget)
        const tagHash = await api.git.addAnnotatedTag(repo.path, name, message, ref || undefined);
        toast.success(tagHash ? t('tags.annotatedCreatedHash', { name, hash: tagHash.slice(0, 7) }) : t('tags.annotatedCreated', { name }));
      } else {
        // annotated=false EXPLICIT: createTag's default is annotated=true,
        // and since the backend fix an explicit annotated choice is honored
        // even with an empty message — omitting the flag here would silently
        // create an annotated tag instead of the requested lightweight one.
        await api.git.createTag(repo.path, name, undefined, ref || undefined, false, false);
        toast.success(t('tags.created', { name }));
      }
      setShowDialog(false);
      setName('');
      setMessage('');
      setRef(selectedCommitHash || 'HEAD');
      setAnnotated(true);
      await load();
    } catch (e) {
      toast.error(t('tags.createFailed'), String(e));
    }
  };

  const handleDelete = async (tag: TagInfo) => {
    if (!(await confirmDialog({
      title: t('tags.deleteTitle', { name: tag.name }),
      message: t('tags.deleteMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.git.deleteTag(repo.path, tag.name);
      toast.success(t('tags.deleted', { name: tag.name }));
      await load();
    } catch (e) {
      toast.error(t('tags.deleteFailed'), String(e));
    }
  };

  /**
   * Checkout a tag — switch the working tree to the tagged commit in
   * DETACHED HEAD state (this is what `git checkout <tag>` does).
   *
   * Detached HEAD is safe — the user can read files, build, etc. They can
   * switch back to a branch with `git checkout main` later. We DON'T
   * auto-create a branch because the user might want to peek at the tag
   * briefly, not start new work on it.
   *
   * Confirmation: shows a dialog because the user might have uncommitted
   * changes (git refuses to checkout in that case — we surface a clear
   * message instead of letting the raw git error confuse the user).
   */
  const handleCheckout = async (tag: TagInfo) => {
    if (!(await confirmDialog({
      title: t('tags.checkoutTitle', { name: tag.name }),
      message: t('tags.checkoutMessage', { name: tag.name }),
      confirmLabel: t('common.checkout'),
    }))) return;
    try {
      // Wrap with logOperation so the OUTPUT panel shows the command.
      await useOperationLogStore.getState().logOperation(
        `Checkout Tag ${tag.name}`,
        repo.path,
        `git checkout ${tag.name}`,
        async () => {
          // NOTE: simple-git may fail here when git-lfs is configured but
          // git-lfs is not installed (filter-process error). The error is
          // caught by the outer try/catch and surfaced as a toast — the
          // app does NOT crash.
          await api.git.checkout(repo.path, tag.name);
        },
      );
      toast.success(t('tags.checkedOut', { name: tag.name }));
      await refreshStatus(repo.path);
    } catch (e) {
      const msg = String(e);
      // Detect the git-lfs filter-process error and show a friendlier message.
      if (msg.includes('git-lfs') && msg.includes('command not found')) {
        toast.error(
          t('tags.checkoutFailed'),
          t('toast.git.lfsFilterFailed') + '\n\n' + msg,
        );
      } else {
        toast.error(t('tags.checkoutFailed'), msg);
      }
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('tags.title')}</span>
          <span className="text-2xs text-text-tertiary">{t('tags.count', { count: tags.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* SmartGit Manual: Tag-Grouping toggle */}
          <button
            className={`icon-btn ${groupByPattern ? 'active' : ''}`}
            title={t('tags.groupTooltip')}
            onClick={() => setGroupByPattern(!groupByPattern)}
          >
            <FolderTree size={13} />
          </button>
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
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
            {t('tags.new')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="empty-state">
            <div className="spinner mb-3" />
            <div className="empty-state-title">{t('tags.loading')}</div>
          </div>
        ) : tags.length === 0 ? (
          <EmptyState
            icon={TagIcon}
            title={t('tags.empty')}
            description={t('tags.emptyDesc')}
          />
        ) : groupByPattern ? (
          // SmartGit Manual: Tag-Grouping display — groups tags by pattern.
          // The grouping is precomputed via the top-level `tagGroups` useMemo
          // (hoisted out of the IIFE — was a hooks violation that occasionally
          // caused excessive re-rendering).
          <>
            {tagGroups.map((group) => {
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
                        <span className="text-2xs text-text-tertiary font-normal">{t('tags.groupCount', { count: group.tags.length })}</span>
                        {group.latest && (
                          <span className="text-2xs text-text-tertiary ml-auto font-mono">
                            {t('tags.latest', { name: group.latest.name })}
                          </span>
                        )}
                      </div>
                      {!collapsed && group.tags.map((t) => (
                        <TagRow
                          key={t.name}
                          tag={t}
                          handleEdit={openEditTag}
                          handleDelete={handleDelete}
                          handleCheckout={handleCheckout}
                          showContextMenu={showContextMenu}
                          selected={selectedTag === t.name}
                        />
                      ))}
                    </div>
                  );
                })}
          </>
        ) : (
          <>
            {(showAll ? tags : tags.slice(0, 200)).map((t) => (
              <TagRow
                key={t.name}
                tag={t}
                handleEdit={openEditTag}
                handleDelete={handleDelete}
                handleCheckout={handleCheckout}
                showContextMenu={showContextMenu}
                selected={selectedTag === t.name}
              />
            ))}
            {tags.length > 200 && !showAll && (
              <button
                className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-2xs text-accent bg-bg-secondary border-b border-border-subtle hover:bg-bg-hover"
                onClick={() => setShowAll(true)}
              >
                <ChevronDown size={10} />
                {t('branches.showAll', { count: tags.length })}
              </button>
            )}
          </>
        )}
      </div>

      {showDialog && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowDialog(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('tags.new')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('tags.nameLabel')}</label>
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
                <label className="text-xs text-text-tertiary block mb-1">{t('tags.refLabel')}</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder={t('tags.refPlaceholder')}
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={annotated}
                  onChange={(e) => setAnnotated(e.target.checked)}
                />
                {t('tags.annotatedTag')}
              </label>
              {annotated && (
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('tags.messageLabel')}</label>
                  <textarea
                    className="w-full text-sm h-20 resize-none"
                    placeholder={t('tags.messagePlaceholder')}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowDialog(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Check size={13} />
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tag EDIT dialog — rename AND message edit in one place.
          git has no tag mutation: save re-creates the tag at the same
          commit (and deletes the old name when the name changed). */}
      {editTag && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={closeEditTag}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-1 flex items-center gap-2">
              <Pencil size={14} />
              {t('tags.editTitle', { name: editTag.name })}
            </h3>
            <div className="text-2xs text-text-tertiary mb-4">
              {t('tags.editDialogHint', { hash: shortHash(editTag.hash) })}
              {editLoading && <span className="spinner inline-block ml-2 align-middle" />}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('tags.nameLabel')}</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="v2.0.0"
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editAnnotated}
                  onChange={(e) => setEditAnnotated(e.target.checked)}
                />
                {t('tags.annotatedTag')}
              </label>
              {editAnnotated && (
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('tags.messageLabel')}</label>
                  <textarea
                    className="w-full text-sm h-24 resize-none"
                    value={editMessage}
                    onChange={(e) => setEditMessage(e.target.value)}
                    placeholder={t('tags.messagePlaceholder')}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={closeEditTag}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={!editName.trim() || editBusy}>
                <Check size={13} />
                {t('common.save')}
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
  tag: t2,
  handleEdit,
  handleDelete,
  handleCheckout,
  showContextMenu,
  selected,
}: {
  tag: TagInfo;
  handleEdit: (tag: TagInfo) => void;
  handleDelete: (tag: TagInfo) => void;
  handleCheckout: (tag: TagInfo) => void;
  showContextMenu: ReturnType<typeof useContextMenu>;
  /** Whether this tag is the globally selected tag (Toolbar chip / other tools see it too). */
  selected: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer ${selected ? 'bg-accent/10 border-l-2 border-l-accent' : ''}`}
      onClick={() => {
        // Cross-tool selection: the tag name AND its commit become global —
        // Toolbar shows the tag chip, History opens the tagged commit.
        useSelectionStore.getState().selectTag(t2.name);
        useSelectionStore.getState().selectCommit(t2.hash);
        window.location.hash = '#/history';
      }}
      title={t('tags.rowTooltip')}
      onContextMenu={(e) => {
        e.preventDefault();
        // MENU STRUCTURE (v3.4): grouped by domain — the tag's own
        // management (edit/delete) lives under “Управление тегами”,
        // clipboard under “Копировать”, navigation stays top-level.
        showContextMenu([
          { label: t('tags.checkoutTag', { name: t2.name }), clickId: 'checkout' },
          { type: 'separator' },
          {
            label: t('ctx.group.tags'),
            submenu: [
              { label: t('tags.editItem', { name: t2.name }), clickId: 'edit' },
              { label: t('tags.deleteTagItem', { name: t2.name }), clickId: 'delete' },
            ],
          },
          {
            label: t('ctx.group.copy'),
            submenu: [
              { label: t('tags.copyName'), clickId: 'copy-name' },
              { label: t('tags.copyHash'), clickId: 'copy-hash' },
            ],
          },
          { type: 'separator' },
          { label: t('tags.viewCommitInHistory'), clickId: 'view-commit' },
        ], (action) => {
          switch (action) {
            case 'checkout': handleCheckout(t2); break;
            case 'copy-name': copyToClipboard(t2.name); break;
            case 'copy-hash': copyToClipboard(t2.hash); break;
            case 'edit': handleEdit(t2); break;
            case 'delete': handleDelete(t2); break;
            case 'view-commit':
              useSelectionStore.getState().selectTag(t2.name);
              useSelectionStore.getState().selectCommit(t2.hash);
              window.location.hash = '#/history';
              break;
          }
        });
      }}
    >
      <TagIcon size={14} className="text-status-modified shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{t2.name}</span>
          {!t2.lightweight && (
            <span className="badge badge-modified">{t('tags.annotatedBadge')}</span>
          )}
        </div>
        {t2.annotation && (
          <div className="text-xs text-text-secondary truncate mt-0.5">
            {t2.annotation}
          </div>
        )}
        <div className="text-xs text-text-tertiary mt-0.5">
          <CommitHashLink hash={t2.hash} />
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
        <button
          className="icon-btn !w-6 !h-6 hover:!text-accent"
          title={t('tags.checkoutTag', { name: t2.name })}
          onClick={(e) => { e.stopPropagation(); handleCheckout(t2); }}
        >
          <GitBranch size={12} />
        </button>
        <button
          className="icon-btn !w-6 !h-6"
          title={t('common.edit')}
          onClick={(e) => { e.stopPropagation(); handleEdit(t2); }}
        >
          <Pencil size={12} />
        </button>
        <button
          className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
          title={t('common.delete')}
          onClick={(e) => { e.stopPropagation(); handleDelete(t2); }}
        >
          <Trash size={12} />
        </button>
      </div>
    </div>
  );
}
