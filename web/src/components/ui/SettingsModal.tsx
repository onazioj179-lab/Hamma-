/**
 * Compact Settings Modal
 * Mobile-first, no-scroll, max 70vh
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, Moon, Sun, Monitor, Brain } from 'lucide-react';
import { useAppStore, type Theme } from '../../store/app';
import { HammaDashboard } from '../HammaDashboard';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHamma, setShowHamma] = useState(false);
  
  const {
    theme,
    setTheme,
    chunkSize,
    setChunkSize,
    autoDownload,
    setAutoDownload,
  } = useAppStore();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/60 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 
                       max-w-xs mx-auto bg-card rounded-2xl shadow-2xl
                       modal-sheet"
            initial={{ opacity: 0, scale: 0.95, y: '-45%' }}
            animate={{ opacity: 1, scale: 1, y: '-50%' }}
            exit={{ opacity: 0, scale: 0.95, y: '-45%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Settings</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close settings"
              >
                <X className="w-4 h-4 text-muted" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Theme - Segmented Control */}
              <SettingGroup label="Theme">
                <div className="segmented-control">
                  {[
                    { value: 'light' as Theme, icon: Sun, label: 'Light theme' },
                    { value: 'system' as Theme, icon: Monitor, label: 'System theme' },
                    { value: 'dark' as Theme, icon: Moon, label: 'Dark theme' },
                  ].map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      aria-label={label}
                      className={`segmented-btn flex items-center justify-center gap-1
                        ${theme === value ? 'segmented-btn-active' : 'segmented-btn-inactive'}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </SettingGroup>

              {/* Auto Download - Toggle */}
              <div className="setting-row">
                <span className="text-sm text-foreground">Auto-download</span>
                <Toggle checked={autoDownload} onChange={setAutoDownload} />
              </div>

              {/* Advanced Accordion */}
              <div className="border-t border-border pt-3">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between text-sm text-muted"
                >
                  <span>Advanced</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-3 space-y-3">
                        {/* Chunk Size - Dropdown */}
                        <div className="setting-row">
                          <span className="text-sm text-foreground">Chunk Size</span>
                          <select
                            value={chunkSize}
                            onChange={(e) => setChunkSize(Number(e.target.value))}
                            className="dropdown-compact text-foreground"
                            aria-label="Chunk size"
                          >
                            <option value={1048576}>1 MB</option>
                            <option value={4194304}>4 MB</option>
                            <option value={16777216}>16 MB</option>
                            <option value={67108864}>64 MB</option>
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* HAMMA Performance Accordion */}
              <div className="border-t border-border pt-3">
                <button
                  onClick={() => setShowHamma(!showHamma)}
                  className="w-full flex items-center justify-between text-sm text-muted"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-500" />
                    <span>HAMMA Stats</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showHamma ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showHamma && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-3">
                        <p className="text-xs text-muted mb-2">
                          Self-learning strategy optimization
                        </p>
                        <button
                          onClick={() => {
                            onClose();
                            window.open('/hamma', '_blank');
                          }}
                          className="w-full py-2 px-3 bg-purple-500/10 hover:bg-purple-500/20 
                                   text-purple-600 dark:text-purple-400 rounded-lg text-sm 
                                   transition-colors"
                        >
                          Open Dashboard
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border">
              <p className="text-xs text-muted text-center">Singularity Pack</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Setting Group wrapper
function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted uppercase tracking-wide">{label}</span>
      {children}
    </div>
  );
}

// Compact Toggle
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`toggle-compact ${checked ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'}`}
      title={checked ? 'Enabled' : 'Disabled'}
    >
      <div className={`toggle-compact-thumb ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}
