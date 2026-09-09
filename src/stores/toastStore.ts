import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  detail?: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  show: (type: ToastType, message: string, detail?: string, duration?: number) => void;
  dismiss: (id: number) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
  warning: (message: string, detail?: string) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (type, message, detail, duration = 4000) => {
    const id = nextId++;
    const toast: Toast = { id, type, message, detail, duration };
    set({ toasts: [...get().toasts, toast] });
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
  },

  dismiss: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  success: (m, d) => get().show('success', m, d),
  error: (m, d) => get().show('error', m, d, 6000),
  info: (m, d) => get().show('info', m, d),
  warning: (m, d) => get().show('warning', m, d, 5000),
}));
