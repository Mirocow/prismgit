import { useState, useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { cn } from '../lib/utils';

type WindowStyle = 'standard' | 'log' | 'working-tree';

const STORAGE_KEY = 'smartgit-window-style';

export function useWindowStyle() {
  const [style, setStyle] = useState<WindowStyle>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as WindowStyle;
      return saved || 'standard';
    } catch {
      return 'standard';
    }
  });

  const change = (s: WindowStyle) => {
    setStyle(s);
    try {
      localStorage.setItem(STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
  };

  return { style, setStyle: change };
}

interface WindowStyleSwitcherProps {
  value: WindowStyle;
  onChange: (s: WindowStyle) => void;
}

export function WindowStyleSwitcher({ value, onChange }: WindowStyleSwitcherProps) {
  const styles: { key: WindowStyle; label: string; title: string }[] = [
    { key: 'standard', label: 'Standard', title: 'Standard window: Changes + History combined' },
    { key: 'log', label: 'Log', title: 'Log window: History-focused view' },
    { key: 'working-tree', label: 'Working Tree', title: 'Working Tree window: Changes-focused view' },
  ];

  return (
    <div className="flex bg-bg-tertiary rounded">
      {styles.map(s => (
        <button
          key={s.key}
          className={cn(
            'px-2 py-0.5 text-2xs transition-colors',
            value === s.key
              ? 'bg-accent text-text-inverse'
              : 'text-text-secondary hover:text-text-primary'
          )}
          title={s.title}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
