import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Star, Folder, FolderOpen, User, Bot, Copy, Check, Trash, Pencil,
  ChevronRight, ChevronDown, FolderPlus, CornerDownRight,
} from './icons';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useAiFavoritesStore, countNotesInTree } from '../stores/aiFavoritesStore';
import { confirmDialog } from './ConfirmDialog';
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
 * No inline preview and no drag & drop — every action is a plain LEFT
 * CLICK, menus follow the app-wide dropdown pattern (relative wrapper +
 * absolute top-full menu + fixed inset-0 click-away overlay).
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
  copiedId: string | null;
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

  const ctx: RowContext = {
    t,
    copiedId,
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

      {/* Tree body */}
      <div className="flex-1 overflow-y-auto p-1.5 min-h-0">
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer select-none transition-colors border border-transparent hover:bg-bg-hover"
        style={{ paddingLeft: depth * 14 + 4 }}
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
        <RowMenu open={menuOpen} setOpen={setMenuOpen}>
          {moving ? (
            <MovePicker
              excludeId={folder.id}
              onPick={(parentId) => {
                setMoving(false);
                setMenuOpen(false);
                useAiFavoritesStore.getState().move(folder.id, parentId);
              }}
            />
          ) : (
            <>
              <MenuItem label={t('aiFav.newFolderInside')} icon={<FolderPlus size={11} />} onClick={() => { setMenuOpen(false); ctx.setCreatingFolderIn(folder.id); }} />
              <MenuItem label={t('aiFav.moveToFolder')} icon={<CornerDownRight size={11} />} onClick={() => setMoving(true)} />
              <MenuItem label={t('aiFav.rename')} icon={<Pencil size={11} />} onClick={() => { setMenuOpen(false); setRenaming(true); }} />
              <MenuItem label={t('common.delete')} icon={<Trash size={11} />} danger onClick={() => { setMenuOpen(false); ctx.onDelete(folder); }} />
            </>
          )}
        </RowMenu>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      className="group flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer select-none transition-colors hover:bg-bg-hover"
      style={{ paddingLeft: depth * 14 + 4 }}
      title={t('aiFav.showInChat')}
      onClick={() => ctx.onJump(note)}
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
      <RowMenu open={menuOpen} setOpen={setMenuOpen}>
        {moving ? (
          <MovePicker
            excludeId={null}
            onPick={(parentId) => {
              setMoving(false);
              setMenuOpen(false);
              useAiFavoritesStore.getState().move(note.id, parentId);
            }}
          />
        ) : (
          <>
            <MenuItem
              label={ctx.copiedId === note.id ? t('aiFav.copied') : t('aiFav.copy')}
              icon={ctx.copiedId === note.id ? <Check size={11} className="text-status-added" /> : <Copy size={11} />}
              onClick={() => ctx.onCopy(note)}
            />
            {ctx.onInsert && (
              <MenuItem label={t('aiFav.insertToInput')} icon={<CornerDownRight size={11} />} onClick={() => { setMenuOpen(false); ctx.onInsert?.(note.content); }} />
            )}
            <MenuItem label={t('aiFav.moveToFolder')} icon={<Folder size={11} className="text-accent" />} onClick={() => setMoving(true)} />
            <MenuItem label={t('aiFav.rename')} icon={<Pencil size={11} />} onClick={() => { setMenuOpen(false); setRenaming(true); }} />
            <MenuItem label={t('common.delete')} icon={<Trash size={11} />} danger onClick={() => { setMenuOpen(false); ctx.onDelete(note); }} />
          </>
        )}
      </RowMenu>
    </div>
  );
}

// ── Small shared pieces ──────────────────────────────────────────────────────

/** App-standard dropdown menu: relative wrapper + absolute top-full menu +
 *  fixed inset-0 click-away overlay. Opens and acts on LEFT CLICK only. */
function RowMenu({
  open, setOpen, children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        className="icon-btn !w-5 !h-5 opacity-70 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <span className="text-xs leading-none">⋯</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute top-full right-0 mt-1 bg-bg-elevated border border-border-default rounded shadow-xl z-50 min-w-[200px] py-1">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  label, icon, danger, onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-bg-hover',
        danger ? 'text-status-deleted' : 'text-text-secondary',
      )}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/** "Move to folder…" picker shown inside the row menu after a left click
 *  on the menu item. Lists every folder except the excluded subtree. */
function MovePicker({
  excludeId, onPick,
}: {
  excludeId: string | null;
  onPick: (parentId: string | null) => void;
}) {
  const { t } = useI18n();
  const tree = useAiFavoritesStore((s) => s.tree);
  const options = collectFolderOptions(tree, excludeId);

  return (
    <>
      <div className="px-3 pt-1 pb-1.5 text-3xs uppercase tracking-wide text-text-tertiary font-semibold border-b border-border-subtle mb-0.5">
        {t('aiFav.moveToFolder')}
      </div>
      <MenuItem label={t('aiFav.moveToRoot')} icon={<CornerDownRight size={11} />} onClick={() => onPick(null)} />
      {options.length === 0 ? (
        <div className="px-3 py-1.5 text-2xs text-text-tertiary italic">
          {t('aiFav.noTargetFolders')}
        </div>
      ) : (
        options.map((f) => (
          <button
            key={f.id}
            className="w-full text-left pr-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-bg-hover text-text-secondary"
            style={{ paddingLeft: 12 + f.depth * 14 }}
            onClick={() => onPick(f.id)}
          >
            <Folder size={11} className="text-accent flex-shrink-0" />
            <span className="truncate flex-1">{f.name}</span>
          </button>
        ))
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
