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
import { CompressionWorkspace } from './components/workspace/CompressionWorkspace';
import { LocalOverview } from './components/workspace/LocalOverview';
import { UniversalWorkspace } from './components/workspace/UniversalWorkspace';

const remoteServer = !['localhost', '127.0.0.1', '::1'].includes(location.hostname);

type View = 'process' | 'compress' | 'files' | 'history' | 'overview' | 'settings';
const navigation = [
  { key: 'process', label: 'Workspace', icon: LayoutGrid },
  { key: 'files', label: 'Files & History', icon: FolderOpen },
  { key: 'overview', label: 'Overview', icon: Files },
] as const;

export default function App() {
  const controller = useCompression();
  const { workerReady, isProcessing, result, cancel, download, deviceInfo } =
    controller;
  const recent = useAppStore((state) => state.recentArchives);
  const { privacyChoice, setPrivacyChoice } = usePreferences();
  const [view, setView] = useState<View>('process');
  useEffect(() => { if (privacyChoice === 'learning') setPrivacyChoice('essential'); }, [privacyChoice, setPrivacyChoice]);
  const [section, setSection] = useState<SettingsSection>('general');
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(() => localStorage.getItem('hamma-terms-v1') === 'accepted');
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
              {key === 'files' && recent.length > 0 && (
                <small>{recent.length}</small>
              )}
              {key === 'process' && isProcessing && (
                <span className="running-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <span>
              <strong>{remoteServer ? 'Private server session' : 'Yours. On your device.'}</strong>
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
            {view !== 'compress' ? (remoteServer ? 'Wi-Fi server' : 'On this device') : isProcessing
              ? 'Processing locally'
              : workerReady
                ? 'Local engine ready'
                : 'Preparing engine'}
            <span className="free-label">Free</span>
          </span>
        </header>
        <main
          {...(!termsAccepted && view !== 'settings' ? { inert: '' } : {})}
          id="workspace-main"
          ref={mainRef}
          tabIndex={-1}
          className="workspace-main"
        >
          <UniversalWorkspace
            spkResult={result}
            onSpkDownload={download}
            visible={view === 'process' || view === 'compress' || view === 'files' || view === 'history'}
            screen={view === 'history' || view === 'files' ? 'history' : 'workspace'}
            onHistory={() => setView('files')}
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
              {(view === 'process' || view === 'compress') && (
                <details className="spk-tools" open={view === 'compress'}><summary>SPK tools</summary>
                <CompressionWorkspace
                  controller={controller}
                  onSelect={selectFiles}
                  onHistory={() => setView('files')}
                /></details>
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
      {!termsAccepted && <aside className="privacy-banner" aria-label="First use agreement"><div><strong>Before you begin</strong><p>Files are processed on the computer running HAMMA. On Wi-Fi, uploads travel to that computer over your local network. Temporary files and job metadata remain until expiry. No AI service receives your contents.</p><a href="#" onClick={event => { event.preventDefault(); openSettings('privacy'); }}>Privacy & terms</a></div><button className="button primary" onClick={() => { localStorage.setItem('hamma-terms-v1', 'accepted'); setTermsAccepted(true); setPrivacyChoice('essential'); }}>Agree & continue</button></aside>}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
