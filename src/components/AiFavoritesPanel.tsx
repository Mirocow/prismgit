import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Star, Folder, FolderOpen, User, Bot, Copy, Check, Trash, Pencil,
  ChevronRight, ChevronDown, CornerDownRight, FolderPlus, Search,
} from './icons';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useAiFavoritesStore, countNotesInTree } from '../stores/aiFavoritesStore';
import { confirmDialog } from './ConfirmDialog';
import {
  type AiFavoriteNode,
  type AiFavoriteNote,
  type AiFavoriteFolder,
} from '../lib/aiFavorites';

/**
 * AI chat favorites — tree panel (shared by the full-page AiChatPage and
 * the floating AiAssistant popup).
 *
 *   📁 folder     click = expand/collapse; ⋯ menu = new folder inside /
 *   │  …            rename / delete; drop target for dragged nodes
 *   └─ 💬 note    click = inline preview + actions (copy / insert into the
 *                  chat input / show in chat); ⋯ menu = rename / delete
 *
 * Notes are SNAPSHOTS: chat history is trimmed to the configured limit, so
 * a favorite keeps its text even after the original message left the
 * history. "Show in chat" jumps to the original when it still exists.
 */

interface AiFavoritesPanelProps {
  /** Insert a note's text into the chat input box. */
  onInsertToInput?: (text: string) => void;
  /** Scroll to + highlight the original message. Return false if not found. */
  onJumpToNote?: (note: AiFavoriteNote) => boolean;
  /** Currently open repository path (stored on new notes as provenance). */
  sessionRepoPath?: string | null;
  className?: string;
}

/** Context shared by every row (defined once, forwarded recursively). */
interface RowContext {
  t: (key: string) => string;
  copiedId: string | null;
  expandedNotes: Set<string>;
  toggleNoteExpanded: (id: string) => void;
  dragOverId: string | null | undefined;
  setDragOverId: (id: string | null | undefined) => void;
  /** undefined = closed; null = new folder at root; string = inside folder */
  creatingFolderIn: string | null | undefined;
  setCreatingFolderIn: (id: string | null | undefined) => void;
  onCopy: (note: AiFavoriteNote) => void;
  onJump: (note: AiFavoriteNote) => void;
  onInsert?: (text: string) => void;
  onDelete: (node: AiFavoriteNode) => void;
}

export function AiFavoritesPanel({ onInsertToInput, onJumpToNote, className }: AiFavoritesPanelProps) {
  const { t } = useI18n();
  const tree = useAiFavoritesStore((s) => s.tree);
  const loaded = useAiFavoritesStore((s) => s.loaded);
  const ensureLoaded = useAiFavoritesStore((s) => s.ensureLoaded);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null | undefined>(undefined);
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const handleCopy = useCallback((note: AiFavoriteNote) => {
    navigator.clipboard.writeText(note.content).then(() => {
      setCopiedId(note.id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => { /* ignore */ });
  }, []);

  const handleJump = useCallback((note: AiFavoriteNote) => {
    const found = onJumpToNote?.(note) ?? false;
    if (!found) alert(t('aiFav.notFoundInChat'));
  }, [onJumpToNote, t]);

  const handleDelete = useCallback(async (node: AiFavoriteNode) => {
    const ok = await confirmDialog({
      title: t('aiFav.deleteTitle'),
      message: node.type === 'folder'
        ? t('aiFav.deleteFolderConfirm').replace('{name}', node.name)
        : t('aiFav.deleteNoteConfirm').replace('{name}', node.name),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) useAiFavoritesStore.getState().remove(node.id);
  }, [t]);

  const toggleNoteExpanded = useCallback((id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const ctx: RowContext = {
    t,
    copiedId,
    expandedNotes,
    toggleNoteExpanded,
    dragOverId,
    setDragOverId,
    creatingFolderIn,
    setCreatingFolderIn,
    onCopy: handleCopy,
    onJump: handleJump,
    onInsert: onInsertToInput,
    onDelete: (n) => void handleDelete(n),
  };

  const noteCount = countNotesInTree(tree);

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-default flex items-center gap-2 bg-bg-elevated">
        <Star size={12} className="text-accent flex-shrink-0" />
        <span className="text-xs font-medium text-text-secondary">{t('aiFav.title')}</span>
        <span className="text-3xs text-text-tertiary ml-auto">
          {noteCount > 0 ? `${noteCount} ${t('aiFav.notes')}` : ''}
        </span>
        <button
          className="icon-btn !w-5 !h-5"
          title={t('aiFav.newFolderRoot')}
          onClick={() => setCreatingFolderIn(null)}
        >
          <FolderPlus size={12} />
        </button>
        <button
          className="icon-btn !w-5 !h-5"
          title={t('aiFav.collapseAll')}
          onClick={() => useAiFavoritesStore.getState().collapseAll()}
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Tree body — dropping on empty space moves a node to the root */}
      <div
        className="flex-1 overflow-y-auto p-1.5 min-h-0"
        onDragOver={(e) => {
          // Only claim the drop when no folder row claimed it (they stopPropagation).
          if (dragOverId !== undefined) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/prismgit-fav');
          if (id) {
            e.preventDefault();
            useAiFavoritesStore.getState().move(id, null);
            setDragOverId(undefined);
          }
        }}
      >
        {!loaded || tree.length === 0 ? (
          <div className="text-2xs text-text-tertiary text-center py-6 px-3 leading-relaxed">
            <Star size={18} className="mx-auto mb-2 opacity-40" />
            {t('aiFav.empty')}
            <div className="mt-1 opacity-80">{t('aiFav.emptyHint')}</div>
          </div>
        ) : (
          <>
            {creatingFolderIn === null && (
              <div className="py-0.5" style={{ paddingLeft: 4 }}>
                <InlineRename
                  initial=""
                  placeholder={t('aiFav.folderName')}
                  autofocus
                  onDone={(name) => {
                    if (name) useAiFavoritesStore.getState().createFolder(null, name);
                    setCreatingFolderIn(undefined);
                  }}
                />
              </div>
            )}
            {tree.map((node) => (
              <TreeRow key={node.id} node={node} depth={0} ctx={ctx} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tree rows ────────────────────────────────────────────────────────────────

function TreeRow({ node, depth, ctx }: { node: AiFavoriteNode; depth: number; ctx: RowContext }) {
  return node.type === 'folder'
    ? <FolderRow node={node} depth={depth} ctx={ctx} />
    : <NoteRow node={node} depth={depth} ctx={ctx} />;
}

function FolderRow({ node: folder, depth, ctx }: { node: AiFavoriteFolder; depth: number; ctx: RowContext }) {
  const { t } = ctx;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isDragOver = ctx.dragOverId === folder.id;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer select-none transition-colors border',
          isDragOver ? 'bg-accent-muted border-accent/40' : 'border-transparent hover:bg-bg-hover',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/prismgit-fav', folder.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (ctx.dragOverId !== folder.id) ctx.setDragOverId(folder.id);
        }}
        onDragLeave={() => { if (ctx.dragOverId === folder.id) ctx.setDragOverId(undefined); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData('text/prismgit-fav');
          if (id && id !== folder.id) useAiFavoritesStore.getState().move(id, folder.id);
          ctx.setDragOverId(undefined);
        }}
        onClick={() => useAiFavoritesStore.getState().toggleFolder(folder.id)}
      >
        {folder.expanded
          ? <ChevronDown size={10} className="text-text-tertiary flex-shrink-0" />
          : <ChevronRight size={10} className="text-text-tertiary flex-shrink-0" />}
        {folder.expanded
          ? <FolderOpen size={12} className="text-accent flex-shrink-0" />
          : <Folder size={12} className="text-accent flex-shrink-0" />}
        {renaming ? (
          <InlineRename
            initial={folder.name}
            onDone={(name) => {
              if (name) useAiFavoritesStore.getState().rename(folder.id, name);
              setRenaming(false);
            }}
          />
        ) : (
          <span className="truncate flex-1" title={folder.name}>{folder.name}</span>
        )}
        <RowMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          items={[
            { label: t('aiFav.newFolderInside'), icon: <FolderPlus size={11} />, action: () => ctx.setCreatingFolderIn(folder.id) },
            { label: t('aiFav.rename'), icon: <Pencil size={11} />, action: () => setRenaming(true) },
            { label: t('common.delete'), icon: <Trash size={11} />, danger: true, action: () => ctx.onDelete(folder) },
          ]}
        />
      </div>

      {folder.expanded && (
        <div>
          {ctx.creatingFolderIn === folder.id && (
            <div className="py-0.5" style={{ paddingLeft: (depth + 1) * 14 + 4 }}>
              <InlineRename
                initial=""
                placeholder={t('aiFav.folderName')}
                autofocus
                onDone={(name) => {
                  if (name) useAiFavoritesStore.getState().createFolder(folder.id, name);
                  ctx.setCreatingFolderIn(undefined);
                }}
              />
            </div>
          )}
          {folder.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRow({ node: note, depth, ctx }: { node: AiFavoriteNote; depth: number; ctx: RowContext }) {
  const { t } = ctx;
  const store = useAiFavoritesStore;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const expanded = ctx.expandedNotes.has(note.id);

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer select-none transition-colors hover:bg-bg-hover',
          expanded && 'bg-bg-secondary',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/prismgit-fav', note.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => ctx.toggleNoteExpanded(note.id)}
      >
        {note.role === 'user'
          ? <User size={11} className="text-text-tertiary flex-shrink-0" />
          : <Bot size={11} className="text-accent flex-shrink-0" />}
        {renaming ? (
          <InlineRename
            initial={note.name}
            onDone={(name) => {
              if (name) store.getState().rename(note.id, name);
              setRenaming(false);
            }}
          />
        ) : (
          <span className="truncate flex-1" title={note.content}>{note.name}</span>
        )}
        <RowMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          items={[
            { label: t('aiFav.copy'), icon: ctx.copiedId === note.id ? <Check size={11} className="text-status-added" /> : <Copy size={11} />, action: () => ctx.onCopy(note) },
            ...(ctx.onInsert ? [{ label: t('aiFav.insertToInput'), icon: <CornerDownRight size={11} />, action: () => ctx.onInsert?.(note.content) }] : []),
            { label: t('aiFav.showInChat'), icon: <Search size={11} />, action: () => ctx.onJump(note) },
            { label: t('aiFav.rename'), icon: <Pencil size={11} />, action: () => setRenaming(true) },
            { label: t('common.delete'), icon: <Trash size={11} />, danger: true, action: () => ctx.onDelete(note) },
          ]}
        />
      </div>

      {/* Inline preview + quick actions */}
      {expanded && (
        <div
          className="mx-1 mb-1 rounded border border-border-subtle bg-bg-tertiary px-2 py-1.5"
          style={{ marginLeft: depth * 14 + 16 }}
        >
          <div className="text-2xs text-text-secondary whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono">
            {note.content}
          </div>
          <div className="mt-1 flex gap-2 text-3xs text-text-tertiary">
            <button
              className="flex items-center gap-0.5 hover:text-accent transition-colors"
              onClick={() => ctx.onCopy(note)}
            >
              {ctx.copiedId === note.id ? <Check size={9} className="text-status-added" /> : <Copy size={9} />}
              {ctx.copiedId === note.id ? t('aiFav.copied') : t('aiFav.copy')}
            </button>
            {ctx.onInsert && (
              <button
                className="flex items-center gap-0.5 hover:text-accent transition-colors"
                onClick={() => ctx.onInsert?.(note.content)}
              >
                <CornerDownRight size={9} />
                {t('aiFav.insertToInput')}
              </button>
            )}
            <button
              className="flex items-center gap-0.5 hover:text-accent transition-colors"
              onClick={() => ctx.onJump(note)}
            >
              <Search size={9} />
              {t('aiFav.showInChat')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small shared pieces ──────────────────────────────────────────────────────

/** ⋯ button + dropdown menu (closes on outside click / item pick). */
function RowMenu({
  open, setOpen, items,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  items: { label: string; icon?: React.ReactNode; danger?: boolean; action: () => void }[];
}) {
  return (
    <>
      <button
        className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <span className="text-xs leading-none">⋯</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            className="absolute right-1 top-6 bg-bg-elevated border border-border-default rounded shadow-xl z-30 py-1 min-w-[160px]"
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item) => (
              <button
                key={item.label}
                className={cn(
                  'w-full text-left px-2.5 py-1 text-2xs flex items-center gap-1.5 transition-colors hover:bg-bg-hover',
                  item.danger ? 'text-status-deleted' : 'text-text-secondary',
                )}
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Inline text input for create/rename — Enter commits, Escape cancels. */
function InlineRename({
  initial, placeholder, autofocus, onDone,
}: {
  initial: string;
  placeholder?: string;
  autofocus?: boolean;
  onDone: (value: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (autofocus) ref.current?.focus();
    ref.current?.select();
  }, [autofocus]);

  return (
    <input
      ref={ref}
      type="text"
      className="flex-1 min-w-0 text-xs px-1.5 py-0.5 bg-bg-primary border border-accent rounded outline-none"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim() || null);
        else if (e.key === 'Escape') onDone(null);
        e.stopPropagation();
      }}
      onBlur={() => onDone(value.trim() || null)}
    />
  );
}
