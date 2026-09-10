import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from './icons';
import { useToastStore } from '../stores/toastStore';
import { cn } from '../lib/utils';

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: 'text-status-added',
  error: 'text-status-deleted',
  warning: 'text-status-modified',
  info: 'text-accent',
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2 animate-slide-up">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div
            key={toast.id}
            className="panel min-w-[280px] max-w-md shadow-lg flex items-start gap-3 p-3 animate-fade-in"
          >
            <Icon size={18} className={cn('flex-shrink-0 mt-0.5', COLORS[toast.type])} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary">{toast.message}</div>
              {toast.detail && (
                <div className="text-xs text-text-secondary mt-1 break-words">
                  {toast.detail}
                </div>
              )}
            </div>
            <button
              className="icon-btn flex-shrink-0"
              onClick={() => dismiss(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
