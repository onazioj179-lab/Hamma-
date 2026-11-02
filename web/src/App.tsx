/**
 * HAMMA - Native-Quality Compression App
 * Professional iOS/Android-style UI
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
  FileArchive,
  AlertTriangle,
  Loader2,
  User,
  FolderOpen,
  LayoutDashboard,
  Zap,
  Shield,
  Upload,
} from 'lucide-react';

import { SettingsModal, DropZoneCompact } from './components/ui';
import { CompressionLoader, ResultCard } from './components/compression';
import { useCompression } from './hooks';
import { useAppStore } from './store/app';
import { useAccountStore } from './store/account';
import { AuthModal, RecoveryPhraseModal } from './components/auth/AuthModal';
const FileManager = lazy(() => import('./components/files/FileManager').then(module => ({ default: module.FileManager })));
const StorageDashboard = lazy(() => import('./components/dashboard/StorageDashboard').then(module => ({ default: module.StorageDashboard })));
const LargeFileCompression = lazy(() => import('./components/compression/LargeFileCompression').then(module => ({ default: module.LargeFileCompression })));

function ViewLoading() {
  return <p role="status" className="text-center text-muted p-8">Loading view…</p>;
}

// Smooth animations
const pageVariants = {
  initial: { opacity: 0, y: 20, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.98 },
};

type ViewType = 'compress' | 'large' | 'files' | 'dashboard';

export default function App() {
  const {
    progress,
    result,
    error,
    selectedFile,
    isIdle,
    isProcessing,
    isComplete,
    isError,
    workerReady,
    compress,
    decompress,
    compressMultiple,
    cancel,
    reset,
    download
  } = useCompression();

  const { settingsOpen, setSettingsOpen, operationType } = useAppStore();
  const {
    isLoggedIn,
    account,
    recoveryPhrase,
    showRecoveryPhrase,
    confirmRecoveryPhraseSaved,
  } = useAccountStore();

  const [currentView, setCurrentView] = useState<ViewType>('compress');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'create' | 'recover'>('login');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) {
        return;
      }
      if (e.key === 'Escape' && isProcessing) {
        e.preventDefault();
        cancel();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o' && isIdle) {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && isComplete && result) {
        e.preventDefault();
        download();
        return;
      }
      if (e.key === 'r' && (isComplete || isError) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        reset();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProcessing, isIdle, isComplete, isError, cancel, download, reset, result]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (files.length === 1) {
        /\.spk$/i.test(files[0].name) ? decompress(files[0]) : compress(files[0]);
      } else {
        compressMultiple(Array.from(files));
      }
    }
    e.target.value = '';
  }, [compress, decompress, compressMultiple]);

  const handleFileSelect = useCallback((file: File) => {
    /\.spk$/i.test(file.name) ? decompress(file) : compress(file);
  }, [compress, decompress]);

  const handleFilesSelect = useCallback((files: File[]) => {
    compressMultiple(files);
  }, [compressMultiple]);

  const handleOpenAuth = useCallback((mode: 'login' | 'create' | 'recover') => {
    setAuthMode(mode);
    setShowAuthModal(true);
  }, []);

  return (
    <div className="app-container">
      {/* Navigation Bar - iOS Style */}
      <header className="nav-bar" aria-label="Application header">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600
                        flex items-center justify-center shadow-lg">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground tracking-tight">HAMMA</h1>
            <p className="text-[10px] text-muted -mt-0.5">By Onazi Treasure Oj</p>
          </div>
        </div>

        {/* Segmented Control - iOS Style */}
        <div className="segmented-control app-navigation" role="navigation" aria-label="Main navigation">
          {[
            { key: 'compress', icon: FileArchive, label: 'Compress' },
            { key: 'large', icon: Upload, label: 'Large Files' },
            { key: 'files', icon: FolderOpen, label: 'Files' },
            { key: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setCurrentView(key as ViewType)}
              aria-current={currentView === key ? 'page' : undefined}
              className={currentView === key ? 'segment-active' : 'segment'}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="w-4 h-4" />
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Right Side - Account & Settings */}
        <div className="flex items-center gap-3">
          {isLoggedIn && account ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-success/10">
              <div className="w-8 h-8 rounded-full bg-success flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-success">{account.displayName}</p>
                <p className="text-[10px] text-muted capitalize">{account.tier} Plan</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenAuth('create')}
                className="px-4 py-2 text-accent text-sm font-semibold hover:opacity-80 transition-opacity"
              >
                Sign Up
              </button>
              <button
                onClick={() => handleOpenAuth('login')}
                className="ios-btn-primary"
              >
                Login
              </button>
            </div>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-card-elevated transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-muted" />
          </button>
        </div>
      </header>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-6 overflow-auto">
        <AnimatePresence mode="wait">
          {/* 100TB Compression View */}
          {currentView === 'large' && (
            <motion.div
              key="large"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="w-full h-full max-w-5xl mx-auto overflow-auto"
            >
              <Suspense fallback={<ViewLoading />}><LargeFileCompression /></Suspense>
            </motion.div>
          )}

          {/* Files View */}
          {currentView === 'files' && (
            <motion.div
              key="files"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="w-full h-full"
            >
              {isLoggedIn ? (
                <Suspense fallback={<ViewLoading />}><FileManager /></Suspense>
              ) : (
                <LoginRequired
                  icon={FolderOpen}
                  title="Your Files"
                  description="Sign in to access your compressed files and manage your storage."
                  onLogin={() => handleOpenAuth('login')}
                  onCreate={() => handleOpenAuth('create')}
                />
              )}
            </motion.div>
          )}

          {/* Dashboard View */}
          {currentView === 'dashboard' && (
            <motion.div
              key="dashboard"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="w-full h-full overflow-auto"
            >
              {isLoggedIn ? (
                <Suspense fallback={<ViewLoading />}><StorageDashboard /></Suspense>
              ) : (
                <LoginRequired
                  icon={LayoutDashboard}
                  title="Dashboard"
                  description="Sign in to view your storage usage, compression stats, and account settings."
                  onLogin={() => handleOpenAuth('login')}
                  onCreate={() => handleOpenAuth('create')}
                />
              )}
            </motion.div>
          )}

          {/* Compress View - Loading State */}
          {currentView === 'compress' && !workerReady && (
            <motion.div
              key="loading"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full max-w-md"
            >
              <div className="ios-card-elevated text-center p-8">
                <div className="w-10 h-10 mx-auto mb-4 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20
                              flex items-center justify-center animate-pulse-subtle">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">Initializing HAMMA</h3>
                <p className="text-sm text-muted mb-6">Loading compression engine...</p>
                <div className="h-1.5 bg-card rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-gradient-to-r from-accent to-purple-500 rounded-full progress-indeterminate" />
                </div>
              </div>
            </motion.div>
          )}

          {/* Compress View - Idle State */}
          {currentView === 'compress' && workerReady && isIdle && (
            <motion.div
              key="dropzone"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="w-full max-w-2xl"
            >
              {/* Hero Section */}
              <div className="text-center mb-8">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 mb-4"
                >
                  <Shield className="w-4 h-4 text-success" />
                  <span className="text-xs font-semibold text-success">Local file processing</span>
                </motion.div>
                <h2 className="text-3xl font-bold text-foreground mb-2">
                  Compress and restore files
                </h2>
                <p className="text-muted max-w-md mx-auto">
                  Create lossless SPK archives on this device. Select an SPK archive to restore it.
                </p>
              </div>

              {/* Drop Zone */}
              <DropZoneCompact
                onFileSelect={handleFileSelect}
                onFilesSelect={handleFilesSelect}
              />

              {/* Feature Pills */}
              <motion.div
                className="flex flex-wrap justify-center gap-3 mt-8"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {[
                  { label: 'Local processing' },
                  { label: 'Lossless archives' },
                  { label: 'ZIP restoration' },
                ].map(({ label }) => (
                  <span
                    key={label}
                    className="px-3 py-1.5 rounded-full text-xs font-medium badge-accent"
                  >
                    {label}
                  </span>
                ))}
              </motion.div>

              {/* Keyboard Shortcut */}
              <p className="text-center text-xs text-muted mt-6">
                Press <kbd className="px-1.5 py-0.5 rounded bg-card-elevated text-foreground font-mono text-[10px]">Ctrl+O</kbd> to select files
              </p>
            </motion.div>
          )}

          {/* Compress View - Processing */}
          {currentView === 'compress' && workerReady && isProcessing && (
            <motion.div
              key="progress"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full flex flex-col items-center"
            >
              <CompressionLoader
                progress={progress}
                fileName={selectedFile?.name}
                onCancel={cancel}
              />
            </motion.div>
          )}

          {/* Compress View - Complete */}
          {currentView === 'compress' && workerReady && isComplete && result && (
            <motion.div
              key="result"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full flex flex-col items-center"
            >
              <ResultCard
                operation={operationType === 'decompress' ? 'decompress' : 'compress'}
                originalSize={result.originalSize}
                compressedSize={result.resultSize}
                compressionRatio={result.ratio}
                duration={result.duration}
                averageSpeed={result.speedMbps * 1024 * 1024 / 8}
                fileName={result.outputName}
                downloadUrl={result.downloadUrl}
                onDownload={download}
                onReset={reset}
              />
            </motion.div>
          )}

          {/* Compress View - Error */}
          {currentView === 'compress' && workerReady && isError && (
            <motion.div
              key="error"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full max-w-md"
            >
              <div className="ios-card-elevated text-center p-8">
                <motion.div
                  className="w-10 h-10 mx-auto mb-4 rounded-lg bg-danger/10 flex items-center justify-center"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                >
                  <AlertTriangle className="w-5 h-5 text-danger" />
                </motion.div>
                <h3 className="text-xl font-bold text-foreground mb-2">{operationType === 'decompress' ? 'Restoration failed' : 'Compression failed'}</h3>
                <p className="text-sm text-muted mb-6 line-clamp-3">{error}</p>
                <button onClick={reset} className="ios-btn-primary w-full">
                  Try Again
                </button>
                <p className="text-xs text-muted mt-4">Press <kbd className="px-1.5 py-0.5 rounded bg-card text-foreground font-mono text-[10px]">R</kbd> to retry</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-3 px-6 flex items-center justify-between border-t border-border/30">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${workerReady ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-xs text-muted">{workerReady ? 'Ready when you are' : 'Preparing engine'}</span>
        </div>
        <span className="text-xs text-muted">
          <span className="text-success font-medium">100% Private</span> • All processing happens locally
        </span>
        {isLoggedIn && (
          <span className="text-xs text-muted">
            Logged in as <span className="text-accent font-medium">{account?.displayName}</span>
          </span>
        )}
      </footer>

      {/* Modals */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {showAuthModal && (
        <AuthModal
          mode={authMode}
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}

      {showRecoveryPhrase && recoveryPhrase && (
        <RecoveryPhraseModal
          phrase={recoveryPhrase}
          onConfirm={confirmRecoveryPhraseSaved}
        />
      )}
    </div>
  );
}

// Login Required Component
interface LoginRequiredProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onLogin: () => void;
  onCreate: () => void;
}

function LoginRequired({ icon: Icon, title, description, onLogin, onCreate }: LoginRequiredProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200 }}
        className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/20 to-purple-500/10
                  flex items-center justify-center mb-6"
      >
        <Icon className="w-5 h-5 text-accent" />
      </motion.div>
      <h3 className="text-2xl font-bold text-foreground mb-3">{title}</h3>
      <p className="text-muted mb-8">{description}</p>
      <div className="flex gap-4">
        <button onClick={onLogin} className="ios-btn-primary">
          Login
        </button>
        <button onClick={onCreate} className="ios-btn-success">
          Create Account
        </button>
      </div>

    </div>
  );
}
