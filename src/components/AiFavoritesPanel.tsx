import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Star, Folder, FolderOpen, User, Bot,
  ChevronRight, ChevronDown, FolderPlus,
} from './icons';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useAiFavoritesStore, countNotesInTree } from '../stores/aiFavoritesStore';
import { useToastActions } from '../stores/toastStore';
import { confirmDialog } from './ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
import {
  type AiFavoriteNode,
  type AiFavoriteNote,
  type AiFavoriteFolder,
  collectFolderOptions,
} from '../lib/aiFavorites';

/**
 * AI chat favorites — tree panel (shared by the full-page AiChatPage and
 * the floating AiAssistant popup).
 *
 *   📁 folder     click = expand/collapse; ⋯ menu (left click) = new
 *   │  …            subfolder / move / rename / delete
 *   └─ 💬 note    click = jump straight to the chat (show the original
 *                  message); ⋯ menu (left click) = copy / insert into
 *                  input / move / rename / delete
 *
 * Row menus are NATIVE Electron menus via useContextMenu() — exactly the
 * same style the rest of the app uses (Sidebar, branches, stashes, …).
 * They open on a plain LEFT CLICK on ⋯; "Move to folder" is a native
 * submenu (no drag & drop). No inline preview — clicking a note goes to
 * the chat and highlights the original message.
 *
 * The tree is GLOBAL: one localStorage key shared by every project, so
 * saved notes are visible no matter which repository is open. Notes are
 * SNAPSHOTS (chat history is trimmed), so a favorite keeps its text even
 * after the original message left the history; "jump to chat" works only
 * when the original still exists in the current chat.
 */

interface AiFavoritesPanelProps {
  /** Insert a note's text into the chat input box. */
  onInsertToInput?: (text: string) => void;
  /** Scroll to + highlight the original message. Return false if not found. */
  onJumpToNote?: (note: AiFavoriteNote) => boolean;
  className?: string;
}

/** Context shared by every row (defined once, forwarded recursively). */
interface RowContext {
  t: (key: string) => string;
  /** undefined = closed; null = new folder at root; string = inside folder */
  creatingFolderIn: string | null | undefined;
  setCreatingFolderIn: (id: string | null | undefined) => void;
  onCopy: (note: AiFavoriteNote) => void;
  onJump: (note: AiFavoriteNote) => void;
  onInsert?: (text: string) => void;
  onDelete: (node: AiFavoriteNode) => void;
}

const NBSP = '\u00A0';

export function AiFavoritesPanel({ onInsertToInput, onJumpToNote, className }: AiFavoritesPanelProps) {
  const { t } = useI18n();
  const showContextMenu = useContextMenu();
  const tree = useAiFavoritesStore((s) => s.tree);
  const loaded = useAiFavoritesStore((s) => s.loaded);
  const ensureLoaded = useAiFavoritesStore((s) => s.ensureLoaded);
  const toast = useToastActions();

  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const handleCopy = useCallback((note: AiFavoriteNote) => {
    navigator.clipboard.writeText(note.content)
      .then(() => toast.success(t('aiFav.copied')))
      .catch(() => { /* ignore */ });
  }, [t, toast]);

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

  const ctx: RowContext = {
    t,
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

      {/* Tree body — right click on empty space: New folder / Collapse all */}
      <div
        className="flex-1 overflow-y-auto p-1.5 min-h-0"
        onContextMenu={(e) => {
          e.preventDefault();
          void showContextMenu([
            { label: t('aiFav.newFolderRoot'), clickId: 'newfolder' },
            { label: t('aiFav.collapseAll'), clickId: 'collapse' },
          ], (id) => {
            if (id === 'newfolder') setCreatingFolderIn(null);
            else if (id === 'collapse') useAiFavoritesStore.getState().collapseAll();
          });
        }}
      >
        {/* New folder at root — also rendered while the tree is empty */}
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
        {!loaded || tree.length === 0 ? (
          <div className="text-2xs text-text-tertiary text-center py-6 px-3 leading-relaxed">
            <Star size={18} className="mx-auto mb-2 opacity-40" />
            {t('aiFav.empty')}
            <div className="mt-1 opacity-80">{t('aiFav.emptyHint')}</div>
          </div>
        ) : (
          tree.map((node) => (
            <TreeRow key={node.id} node={node} depth={0} ctx={ctx} />
          ))
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
  const showContextMenu = useContextMenu();
  const [renaming, setRenaming] = useState(false);

  const openMenu = () => {
    const tree = useAiFavoritesStore.getState().tree;
    const items = [
      { label: t('aiFav.newFolderInside'), clickId: 'newfolder' },
      { type: 'separator' as const },
      {
        label: t('aiFav.moveToFolder'),
        submenu: [
          { label: t('aiFav.moveToRoot'), clickId: 'move:root' },
          ...collectFolderOptions(tree, folder.id).map((f) => ({
            label: NBSP.repeat(f.depth * 2) + f.name,
            clickId: `move:${f.id}`,
          })),
        ],
      },
      { type: 'separator' as const },
      { label: t('aiFav.rename'), clickId: 'rename' },
      { label: t('common.delete'), clickId: 'delete' },
    ];
    void showContextMenu(items, (id) => {
      if (id === 'newfolder') ctx.setCreatingFolderIn(folder.id);
      else if (id === 'rename') setRenaming(true);
      else if (id === 'delete') ctx.onDelete(folder);
      else if (id.startsWith('move:')) {
        const target = id.slice('move:'.length);
        useAiFavoritesStore.getState().move(folder.id, target === 'root' ? null : target);
      }
    });
  };

  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer select-none transition-colors border border-transparent hover:bg-bg-hover"
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => useAiFavoritesStore.getState().toggleFolder(folder.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu();
        }}
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
        <button
          className="icon-btn !w-5 !h-5 opacity-70 group-hover:opacity-100 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            openMenu();
          }}
        >
          <span className="text-xs leading-none">⋯</span>
        </button>
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
  const showContextMenu = useContextMenu();
  const [renaming, setRenaming] = useState(false);

  const openMenu = () => {
    const tree = useAiFavoritesStore.getState().tree;
    const items = [
      { label: t('aiFav.copy'), clickId: 'copy' },
      ...(ctx.onInsert ? [{ label: t('aiFav.insertToInput'), clickId: 'insert' }] : []),
      { type: 'separator' as const },
      {
        label: t('aiFav.moveToFolder'),
        submenu: [
          { label: t('aiFav.moveToRoot'), clickId: 'move:root' },
          ...collectFolderOptions(tree, null).map((f) => ({
            label: NBSP.repeat(f.depth * 2) + f.name,
            clickId: `move:${f.id}`,
          })),
        ],
      },
      { type: 'separator' as const },
      { label: t('aiFav.rename'), clickId: 'rename' },
      { label: t('common.delete'), clickId: 'delete' },
    ];
    void showContextMenu(items, (id) => {
      if (id === 'copy') ctx.onCopy(note);
      else if (id === 'insert') ctx.onInsert?.(note.content);
      else if (id === 'rename') setRenaming(true);
      else if (id === 'delete') ctx.onDelete(note);
      else if (id.startsWith('move:')) {
        const target = id.slice('move:'.length);
        useAiFavoritesStore.getState().move(note.id, target === 'root' ? null : target);
      }
    });
  };

  return (
    <div
      className="group flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer select-none transition-colors hover:bg-bg-hover"
      style={{ paddingLeft: depth * 14 + 4 }}
      title={t('aiFav.showInChat')}
      onClick={() => ctx.onJump(note)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu();
      }}
    >
      {note.role === 'user'
        ? <User size={11} className="text-text-tertiary flex-shrink-0" />
        : <Bot size={11} className="text-accent flex-shrink-0" />}
      {renaming ? (
        <InlineRename
          initial={note.name}
          onDone={(name) => {
            if (name) useAiFavoritesStore.getState().rename(note.id, name);
            setRenaming(false);
          }}
        />
      ) : (
        <span className="truncate flex-1">{note.name}</span>
      )}
      <button
        className="icon-btn !w-5 !h-5 opacity-70 group-hover:opacity-100 flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          openMenu();
        }}
      >
        <span className="text-xs leading-none">⋯</span>
      </button>
    </div>
  );
}

// ── Small shared pieces ──────────────────────────────────────────────────────

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
