import { create } from 'zustand';

type WindowStyle = 'standard' | 'log' | 'working-tree';

const STORAGE_KEY = 'prismgit-window-style';

interface WindowStyleState {
  style: WindowStyle;
  setStyle: (s: WindowStyle) => void;
}

// Initialize from localStorage
function getInitialStyle(): WindowStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as WindowStyle | null;
    return saved || 'standard';
  } catch {
    return 'standard';
  }
}

export const useWindowStyleStore = create<WindowStyleState>((set) => ({
  style: getInitialStyle(),
  setStyle: (s) => {
    set({ style: s });
    try {
      localStorage.setItem(STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
  },
}));

// Keep the old hook API for backward compatibility
export function useWindowStyle() {
  const style = useWindowStyleStore((s) => s.style);
  const setStyle = useWindowStyleStore((s) => s.setStyle);
  return { style, setStyle };
}

interface WindowStyleSwitcherProps {
  value: WindowStyle;
  onChange: (s: WindowStyle) => void;
}

export function WindowStyleSwitcher({ value, onChange }: WindowStyleSwitcherProps) {
  const { t } = useI18n();
  const styles: { key: WindowStyle; label: string; title: string }[] = [
    { key: 'standard', label: t('shell.windowStyleStandard'), title: t('shell.windowStyleStandardTitle') },
    { key: 'log', label: t('shell.windowStyleLog'), title: t('shell.windowStyleLogTitle') },
    { key: 'working-tree', label: t('shell.windowStyleWorktree'), title: t('shell.windowStyleWorktreeTitle') },
  ];

  return (
    <div className="flex bg-bg-tertiary rounded no-drag">
      {styles.map(s => (
        <button
          key={s.key}
          className={cn(
            'px-2 py-0.5 text-2xs transition-colors rounded',
            value === s.key
              ? 'bg-accent text-text-inverse'
              : 'text-text-secondary hover:text-text-primary'
          )}
          title={s.title}
          onClick={(e) => {
            e.stopPropagation();
            onChange(s.key);
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// Re-export cn to avoid circular imports
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
