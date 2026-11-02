import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  HelpCircle,
  FileArchive,
  Files,
  FolderOpen,
  History,
  LayoutGrid,
  Loader2,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useCompression } from './hooks/useCompression';
import { useAppStore } from './store/app';
import { usePreferences } from './store/preferences';
import {
  SettingsPanel,
  type SettingsSection,
} from './components/ui/SettingsPanel';
import { ActivityHistory } from './components/files/ActivityHistory';
import { CompressionWorkspace } from './components/workspace/CompressionWorkspace';
import { LocalFiles } from './components/workspace/LocalFiles';
import { LocalOverview } from './components/workspace/LocalOverview';
import { UniversalWorkspace } from './components/workspace/UniversalWorkspace';

type View = 'process' | 'compress' | 'files' | 'history' | 'overview' | 'settings';
const navigation = [
  { key: 'process', label: 'Workspace', icon: LayoutGrid },
  { key: 'compress', label: 'SPK archives', icon: FileArchive },
  { key: 'files', label: 'My files', icon: FolderOpen },
  { key: 'history', label: 'History', icon: History },
  { key: 'overview', label: 'Overview', icon: Files },
] as const;

export default function App() {
  const controller = useCompression();
  const { workerReady, isProcessing, result, cancel, download, deviceInfo } =
    controller;
  const recent = useAppStore((state) => state.recentArchives);
  const { privacyChoice, setPrivacyChoice } = usePreferences();
  const [view, setView] = useState<View>('process');
  const [section, setSection] = useState<SettingsSection>('general');
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const openSettings = (next: SettingsSection) => {
    setSection(next);
    setView('settings');
  };
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view]);
  const selectFiles = useCallback(
    async (files: File[]) => {
      if (isProcessing || !workerReady || !files.length) return;
      setView('compress');
      if (files.length === 1) {
        return /\.spk$/i.test(files[0].name)
          ? controller.decompress(files[0])
          : controller.compress(files[0]);
      }
      return controller.compressMultiple(files);
    },
    [
      isProcessing,
      workerReady,
      controller.compress,
      controller.decompress,
      controller.compressMultiple,
    ],
  );
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.isContentEditable || target?.closest('input,textarea,select'))
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'o' &&
        (view === 'process' || workerReady) &&
        !isProcessing
      ) {
        event.preventDefault();
        if (view === 'process') document.querySelector<HTMLInputElement>('input[aria-label="Add files to queue"]')?.click();
        else inputRef.current?.click();
      }
      if (event.key === 'Escape' && isProcessing) {
        event.preventDefault();
        cancel();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 's' &&
        result?.downloadUrl
      ) {
        event.preventDefault();
        download();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [view, workerReady, isProcessing, result, cancel, download]);

  const selectedTitle =
    view === 'settings'
      ? 'Settings'
      : navigation.find((item) => item.key === view)?.label;
  return (
    <div
      className={`hamma-shell ${privacyChoice === null ? 'privacy-open' : ''}`}
    >
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Application sidebar">
        <button
          className="brand"
          onClick={() => setView('process')}
          aria-label="HAMMA workspace"
        >
          <span className="brand-symbol">
            <FileArchive size={21} strokeWidth={1.6} />
          </span>
          <span>
            <strong>HAMMA</strong>
            <small>Space, simplified.</small>
          </span>
        </button>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="primary-navigation" aria-label="Main navigation">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              aria-current={view === key ? 'page' : undefined}
              onClick={() => setView(key)}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{label}</span>
              {key === 'history' && recent.length > 0 && (
                <small>{recent.length}</small>
              )}
              {key === 'compress' && isProcessing && (
                <span className="running-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <span>
              <strong>Yours. On your device.</strong>
              <small>Free, with no account needed.</small>
            </span>
          </div>
          <button
            className={`sidebar-utility ${view === 'settings' && section !== 'about' ? 'selected' : ''}`}
            onClick={() => openSettings('general')}
            aria-current={view === 'settings' ? 'page' : undefined}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <button
            className={`sidebar-utility ${view === 'settings' && section === 'about' ? 'selected' : ''}`}
            onClick={() => openSettings('about')}
          >
            <HelpCircle size={17} />
            <span>About HAMMA</span>
            <ArrowUpRight size={13} />
          </button>
          <div className="watermark">
            <strong>HAMMA</strong>
            <span>By Onazi Treasure Oj</span>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="breadcrumbs">
            <span>Personal workspace</span>
            <ChevronRight size={12} />
            <strong>{selectedTitle}</strong>
          </div>
          <span className="engine-status">
            <span
              className={workerReady ? 'status-dot' : 'status-dot pending'}
            />
            {view !== 'compress' ? 'On this device' : isProcessing
              ? 'Processing locally'
              : workerReady
                ? 'Local engine ready'
                : 'Preparing engine'}
            <span className="free-label">Free</span>
          </span>
        </header>
        <main
          id="workspace-main"
          ref={mainRef}
          tabIndex={-1}
          className="workspace-main"
        >
          <UniversalWorkspace
            visible={view === 'process' || view === 'files' || view === 'history'}
            screen={view === 'history' ? 'history' : view === 'files' ? 'files' : 'workspace'}
            onHistory={() => setView('history')}
          />
          {!workerReady ? (
            <section hidden={view !== 'compress'} className="splash-screen" role="status">
              <span className="splash-symbol">
                <FileArchive size={26} />
              </span>
              <p className="eyebrow">HAMMA</p>
              <h1>A little room for more.</h1>
              <p>Preparing your local workspace…</p>
              <Loader2 size={18} className="animate-spin" />
            </section>
          ) : (
            <>
              {view === 'compress' && (
                <CompressionWorkspace
                  controller={controller}
                  onSelect={selectFiles}
                  onHistory={() => setView('history')}
                />
              )}
              {view === 'history' && <details className="processing-options"><summary>SPK history</summary><ActivityHistory /></details>}
              {view === 'files' && (
                <details className="processing-options"><summary>SPK result</summary>
                <LocalFiles
                  controller={controller}
                  onWorkspace={() => setView('compress')}
                />
                </details>
              )}
              {view === 'overview' && (
                <LocalOverview
                  device={deviceInfo}
                  onPrivacy={() => openSettings('privacy')}
                />
              )}
              {view === 'settings' && (
                <SettingsPanel
                  section={section}
                  onSectionChange={setSection}
                  busy={isProcessing}
                />
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>Made to make room.</span>
            <span>
              HAMMA <span aria-hidden="true">/</span> Onazi Treasure Oj
            </span>
          </footer>
        </main>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Choose files"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          void selectFiles(files);
        }}
      />
      {privacyChoice === null && workerReady && (
        <aside className="privacy-banner" aria-label="Privacy choices">
          <span className="privacy-symbol">
            <ShieldCheck size={19} />
          </span>
          <div>
            <strong>Your files. Your choice.</strong>
            <p>
              No tracking or third-party uploads. Allow optional local learning of
              sizes and times, or keep essential settings only.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => {
                setPrivacyChoice('essential');
                setAnnouncement(
                  'Essential settings only. Local learning is off.',
                );
              }}
            >
              Essential only
            </button>
            <button
              className="button primary"
              onClick={() => {
                setPrivacyChoice('learning');
                setAnnouncement(
                  'Local performance learning enabled. Nothing is uploaded.',
                );
              }}
            >
              Allow local learning
            </button>
          </div>
        </aside>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
