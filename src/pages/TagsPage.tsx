import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tag as TagIcon, Plus, Trash, RefreshCw, Check, Pencil, ChevronDown, ChevronRight, FolderTree } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type TagInfo } from '../lib/api';
import { shortHash } from '../lib/utils';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
import { copyToClipboard } from '../lib/utils';
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
      toast.success(t('tags.renamed', { old: tag.name, new: newName }));
      setRenamingTag(null);
      await load();
    } catch (e) {
      toast.error(t('tags.renameFailed'), String(e));
      setRenamingTag(null);
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
  }, [repo.path, toast]);

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
        await api.git.createTag(repo.path, name, undefined, ref || undefined);
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
          <div className="empty-state">
            <TagIcon size={48} className="empty-state-icon" />
            <div className="empty-state-title">{t('tags.empty')}</div>
            <div className="empty-state-desc">
              {t('tags.emptyDesc')}
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
                {t('tags.showingFirst200', { count: tags.length })}
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
    </div>
  );
}

/** Tag row — used in both flat and grouped display. */
function TagRow({
  tag: t2,
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
        showContextMenu([
          { label: t('tags.copyName'), clickId: 'copy-name' },
          { label: t('tags.copyHash'), clickId: 'copy-hash' },
          { type: 'separator' },
          { label: t('tags.renameItem', { name: t2.name }), clickId: 'rename' },
          { label: t('tags.deleteTagItem', { name: t2.name }), clickId: 'delete' },
          { type: 'separator' },
          { label: t('tags.viewCommitInHistory'), clickId: 'view-commit' },
        ], (action) => {
          switch (action) {
            case 'copy-name': copyToClipboard(t2.name); break;
            case 'copy-hash': copyToClipboard(t2.hash); break;
            case 'rename': setRenamingTag(t2.name); setRenameValue(t2.name); break;
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
      <TagIcon size={14} className="text-status-modified flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {renamingTag === t2.name ? (
            <input
              type="text"
              className="text-xs w-32 px-1 py-0.5"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(t2);
                if (e.key === 'Escape') setRenamingTag(null);
              }}
              onBlur={() => handleRename(t2)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-text-primary">{t2.name}</span>
          )}
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
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
        <button
          className="icon-btn !w-6 !h-6"
          title={t('common.rename')}
          onClick={(e) => { e.stopPropagation(); setRenamingTag(t2.name); setRenameValue(t2.name); }}
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
