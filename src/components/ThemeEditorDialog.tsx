import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { getThemeMeta, type CustomThemeColors, type CustomThemeEntry } from '../lib/themes';
import { cn } from '../lib/utils';
import { Palette, Pencil, Trash, X } from './icons';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog } from './ConfirmDialog';

/**
 * Custom Theme Editor — the visual replacement for the old raw-JSON
 * customThemeOverrides textarea (user request: «убери такое количество тем…
 * дай возможность самому создавать тему», «в теме надо менять и цвета текста
 * в инструментах»).
 *
 * 13 color inputs grouped by purpose (surfaces / text / accent / status) +
 * a name + a light/dark flag + the sidebar color (that's how the
 * dark-sidebar + light-main look is built). A live pseudo-window preview
 * mirrors the picker cards. Saving upserts into settings.customThemes; the
 * card in the picker applies it.
 */

interface ColorField {
  key: keyof CustomThemeColors;
  labelKey: string;
}

const SURFACES: ColorField[] = [
  { key: 'bgPrimary', labelKey: 'settings.swatchBgPrimary' },
  { key: 'bgSecondary', labelKey: 'settings.swatchBgSecondary' },
  { key: 'bgTertiary', labelKey: 'settings.swatchBgTertiary' },
  { key: 'bgElevated', labelKey: 'settings.swatchBgElevated' },
  { key: 'bgSidebar', labelKey: 'settings.swatchBgSidebar' },
];
const TEXT: ColorField[] = [
  { key: 'textPrimary', labelKey: 'settings.swatchTextPrimary' },
  { key: 'textSecondary', labelKey: 'settings.swatchTextSecondary' },
  { key: 'textTertiary', labelKey: 'settings.swatchTextTertiary' },
];
const ACCENT: ColorField[] = [
  { key: 'accent', labelKey: 'settings.swatchAccent' },
  { key: 'border', labelKey: 'settings.swatchBorder' },
];
const STATUS: ColorField[] = [
  { key: 'statusAdded', labelKey: 'settings.swatchAdded' },
  { key: 'statusModified', labelKey: 'settings.swatchModified' },
  { key: 'statusDeleted', labelKey: 'settings.swatchDeleted' },
  { key: 'statusConflict', labelKey: 'settings.swatchConflict' },
  { key: 'statusUntracked', labelKey: 'settings.swatchUntracked' },
];

/** Seed defaults for NEW themes from the CURRENT theme (curated) or the
 *  light/dark base — the user starts from something sane, not from blank. */
function seedColors(currentTheme: string, seedFrom?: CustomThemeEntry | null): CustomThemeColors {
  if (seedFrom) return { ...seedFrom.colors };
  const meta = getThemeMeta(currentTheme);
  const p = meta?.preview;
  if (p) {
    return {
      bgPrimary: p.bgPrimary, bgSecondary: p.bgSecondary, bgTertiary: p.bgTertiary,
      textPrimary: p.textPrimary, textSecondary: p.textSecondary, textTertiary: p.textSecondary,
      accent: p.accent, border: p.border,
      statusAdded: p.statusAdded, statusModified: p.statusModified, statusDeleted: p.statusDeleted,
    };
  }
  return {
    bgPrimary: '#f7f8fa', bgSecondary: '#ffffff', bgTertiary: '#eef0f3',
    textPrimary: '#2c3138', textSecondary: '#5c6166', textTertiary: '#5c6166',
    accent: '#399ee6', border: '#d8dade',
    statusAdded: '#86b300', statusModified: '#f2ae49', statusDeleted: '#f07171',
  };
}

export function ThemeEditorDialog({
  open,
  editing,
  currentTheme,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  /** The entry being edited, or null when creating a new theme. */
  editing: CustomThemeEntry | null;
  /** Active theme id (seeds defaults for new themes). */
  currentTheme: string;
  onClose: () => void;
  onSave: (entry: CustomThemeEntry) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [isDark, setIsDark] = useState(false);
  const [colors, setColors] = useState<CustomThemeColors>({});

  useEscapeKey(open, onClose);

  // (Re)seed local state when the dialog OPENS or switches target. NOTE the
  // deliberately narrow deps: `t` and `currentTheme` are excluded — `t`
  // changes identity when the async locale init lands, which re-ran this
  // effect MID-EDIT and wiped the user's typed name/colors back to the seed
  // (caught live by the e2e: saved name was the default, not «Тест-тема»).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? t('settings.themeEditorDefaultName', { defaultValue: 'Моя тема' }));
    setIsDark(editing?.isDark ?? (getThemeMeta(currentTheme)?.isDark ?? false));
    setColors(seedColors(currentTheme, editing));
  }, [open, editing]);

  const preview = useMemo(() => ({
    bgPrimary: colors.bgPrimary ?? (isDark ? '#282c34' : '#f7f8fa'),
    bgSecondary: colors.bgSidebar ?? colors.bgSecondary ?? (isDark ? '#21252b' : '#ffffff'),
    bgTertiary: colors.bgTertiary ?? (isDark ? '#2c313a' : '#eef0f3'),
    textPrimary: colors.textPrimary ?? (isDark ? '#abb2bf' : '#2c3138'),
    textSecondary: colors.textSecondary ?? (isDark ? '#7f8c98' : '#5c6166'),
    accent: colors.accent ?? '#399ee6',
    border: colors.border ?? (isDark ? '#3b4048' : '#d8dade'),
    statusAdded: colors.statusAdded ?? '#86b300',
    statusModified: colors.statusModified ?? '#f2ae49',
    statusDeleted: colors.statusDeleted ?? '#f07171',
  }), [colors, isDark]);

  if (!open) return null;

  const setColor = (key: keyof CustomThemeColors, value: string) =>
    setColors((c) => ({ ...c, [key]: value }));

  const handleSave = () => {
    const trimmed = name.trim() || t('settings.themeEditorDefaultName', { defaultValue: 'Моя тема' });
    const entry: CustomThemeEntry = {
      id: editing?.id ?? `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
      name: trimmed,
      isDark,
      colors,
    };
    onSave(entry);
    onClose();
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!(await confirmDialog({
      title: t('settings.themeEditorDeleteTitle', { defaultValue: 'Удалить тему?' }),
      message: t('settings.themeEditorDeleteMessage', { name: editing.name }),
      confirmLabel: t('common.delete', { defaultValue: 'Удалить' }),
      danger: true,
    }))) return;
    onDelete(editing.id);
    onClose();
  };

  const renderField = (f: ColorField) => {
    const value = colors[f.key] ?? '';
    return (
      <label key={f.key} className="flex items-center justify-between gap-2 py-1">
        <span className="text-xs text-text-secondary min-w-0 truncate">
          {t(f.labelKey, { defaultValue: f.key })}
          {f.key === 'bgSidebar' && (
            <span className="text-2xs text-text-tertiary block truncate">
              {t('settings.themeEditorSidebarNote', { defaultValue: 'Тёмный сайдбар при светлом окне' })}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <input
            type="color"
            className="w-7 h-7 rounded border border-border-default cursor-pointer bg-transparent p-0.5"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
            onChange={(e) => setColor(f.key, e.target.value)}
            title={t('settings.themeEditorPickColor', { defaultValue: 'Выбрать цвет' })}
          />
          <input
            type="text"
            className="w-20 text-2xs font-mono bg-bg-tertiary border border-border-default rounded px-1.5 py-1"
            placeholder="#rrggbb"
            value={value}
            onChange={(e) => setColor(f.key, e.target.value)}
            spellCheck={false}
          />
        </span>
      </label>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="panel w-[640px] max-w-[92vw] max-h-[86vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.themeEditorTitle', { defaultValue: 'Редактор темы' })}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
          <h3 className="text-sm font-medium flex items-center gap-2">
            {editing ? <Pencil size={14} /> : <Palette size={14} />}
            {editing
              ? t('settings.themeEditorEditTitle', { defaultValue: 'Редактирование темы' })
              : t('settings.themeEditorCreateTitle', { defaultValue: 'Новая тема' })}
          </h3>
          <button className="icon-btn" onClick={onClose} title={t('common.close')}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex gap-4">
          {/* Left: inputs */}
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                className="flex-1 text-sm"
                placeholder={t('settings.themeEditorNamePlaceholder', { defaultValue: 'Название темы' })}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={isDark}
                  onChange={(e) => setIsDark(e.target.checked)}
                />
                {t('settings.themeEditorIsDark', { defaultValue: 'Тёмная' })}
              </label>
            </div>

            {[
              { titleKey: 'settings.themeEditorGroupSurfaces', fields: SURFACES },
              { titleKey: 'settings.themeEditorGroupText', fields: TEXT },
              { titleKey: 'settings.themeEditorGroupAccent', fields: ACCENT },
              { titleKey: 'settings.themeEditorGroupStatus', fields: STATUS },
            ].map((g) => (
              <div key={g.titleKey} className="border-t border-border-subtle pt-2">
                <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-1">
                  {t(g.titleKey, { defaultValue: g.titleKey })}
                </div>
                {g.fields.map(renderField)}
              </div>
            ))}
          </div>

          {/* Right: live pseudo-window preview (same design as the picker) */}
          <div className="w-56 shrink-0">
            <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
              {t('settings.themeEditorPreview', { defaultValue: 'Предпросмотр' })}
            </div>
            <div
              className="rounded-md border border-border-default overflow-hidden"
              style={{ background: preview.bgPrimary }}
            >
              <div
                className="flex items-center gap-1.5 px-2 py-1.5 border-b"
                style={{ background: preview.bgTertiary, borderColor: preview.border }}
              >
                <span className="rounded-full" style={{ width: 8, height: 8, background: preview.statusDeleted, display: 'inline-block' }} />
                <span className="rounded-full" style={{ width: 8, height: 8, background: preview.statusModified, display: 'inline-block' }} />
                <span className="rounded-full" style={{ width: 8, height: 8, background: preview.statusAdded, display: 'inline-block' }} />
                <span className="ml-1 text-2xs font-medium truncate flex-1" style={{ color: preview.textPrimary }}>
                  {name || t('settings.themeEditorDefaultName', { defaultValue: 'Моя тема' })}
                </span>
              </div>
              <div className="flex" style={{ minHeight: 90 }}>
                <div
                  className="flex flex-col gap-1 p-1.5"
                  style={{ width: 48, background: preview.bgSecondary, borderRight: `1px solid ${preview.border}` }}
                >
                  <div className="rounded-sm" style={{ height: 7, background: preview.accent, opacity: 0.5 }} />
                  <div className="rounded-sm" style={{ height: 7, background: preview.textPrimary, opacity: 0.25 }} />
                  <div className="rounded-sm" style={{ height: 7, background: preview.textPrimary, opacity: 0.25 }} />
                  <div className="rounded-sm" style={{ height: 7, background: preview.textPrimary, opacity: 0.25 }} />
                </div>
                <div className="flex-1 p-2 flex flex-col gap-1" style={{ background: preview.bgPrimary }}>
                  <div className="flex items-center gap-1 text-2xs" style={{ color: preview.textPrimary }}>
                    <span style={{ color: preview.statusModified, fontWeight: 700 }}>M</span>
                    <span style={{ opacity: 0.85 }}>file.ts</span>
                  </div>
                  <div className="flex items-center gap-1 text-2xs" style={{ color: preview.textPrimary }}>
                    <span style={{ color: preview.statusAdded, fontWeight: 700 }}>A</span>
                    <span style={{ opacity: 0.85 }}>new.ts</span>
                  </div>
                  <div className="text-2xs" style={{ color: preview.textSecondary, opacity: 0.8 }}>
                    {t('settings.themeEditorTextSample', { defaultValue: 'Текст вторичного цвета' })}
                  </div>
                  <div
                    className="self-start mt-auto px-1.5 py-0.5 rounded text-2xs font-medium"
                    style={{ background: preview.accent, color: preview.bgPrimary }}
                  >
                    {t('settings.sampleButton')}
                  </div>
                </div>
              </div>
            </div>
            <div className="text-2xs text-text-tertiary mt-2 leading-relaxed">
              {t('settings.themeEditorHint', { defaultValue: 'Цвета текста применяются во всех инструментах. Поле «Сайдбар» задаёт фон левой панели — тёмный фон + светлые поверхности дают стиль VS Code.' })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          {editing && (
            <button
              className="btn btn-secondary text-xs hover:!text-status-deleted ml-auto"
              onClick={() => void handleDelete()}
            >
              <Trash size={12} /> {t('common.delete', { defaultValue: 'Удалить' })}
            </button>
          )}
          <div className={cn('flex gap-2', !editing && 'ml-auto')}>
            <button className="btn btn-secondary text-xs" onClick={onClose}>
              {t('action.button.cancel')}
            </button>
            <button className="btn btn-primary text-xs" onClick={handleSave}>
              {t('common.save', { defaultValue: 'Сохранить' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
