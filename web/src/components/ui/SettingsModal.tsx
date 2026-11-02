import { useEffect, useRef } from 'react';
import { X, Moon, Sun, Monitor } from 'lucide-react';
import { useAppStore, type Theme } from '../../store/app';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Settings supported by the active local compression workflow. */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme, autoDownload, setAutoDownload } = useAppStore();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab' && dialog) {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href]'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="ios-modal-overlay" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title"
        className="ios-modal modal-sheet" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="settings-title" className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-card-elevated" aria-label="Close settings">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium mb-2">Appearance</legend>
            <div className="segmented-control theme-options w-full">
              {[
                { value: 'light' as Theme, icon: Sun, label: 'Light' },
                { value: 'system' as Theme, icon: Monitor, label: 'System' },
                { value: 'dark' as Theme, icon: Moon, label: 'Dark' },
              ].map(({ value, icon: Icon, label }) => (
                <button key={value} onClick={() => setTheme(value)} aria-pressed={theme === value}
                  className="flex items-center justify-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="setting-row">
            <div>
              <p id="auto-download-label" className="text-sm font-medium">Auto-download</p>
              <p id="auto-download-description" className="text-xs text-muted mt-1">Download completed results automatically.</p>
            </div>
            <button type="button" role="switch" aria-checked={autoDownload}
              aria-labelledby="auto-download-label" aria-describedby="auto-download-description"
              onClick={() => setAutoDownload(!autoDownload)}
              className={`toggle-compact ${autoDownload ? 'bg-accent' : 'bg-gray-400'}`}>
              <span className={`toggle-compact-thumb ${autoDownload ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
