import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  FileArchive,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Settings2,
} from 'lucide-react';
import { useCompression } from './hooks/useCompression';
import { useAppStore } from './store/app';
import { usePreferences } from './store/preferences';
import {
  SettingsPanel,
  type SettingsSection,
} from './components/ui/SettingsPanel';
import { LocalOverview } from './components/workspace/LocalOverview';
import { UniversalWorkspace } from './components/workspace/UniversalWorkspace';
import { AccountPanel } from './components/ui/AccountPanel';

type View = 'process' | 'files' | 'overview' | 'settings' | 'account';
type Route = { view: View; section: SettingsSection };

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const section = params.get('section');
  if (view === 'settings') {
    return {
      view,
      section: section === 'privacy' || section === 'storage' || section === 'about'
        ? section
        : 'general',
    };
  }
  if (view === 'files' || view === 'overview' || view === 'account') {
    return { view, section: 'general' };
  }
  return { view: 'process', section: 'general' };
}

const navigation = [
  { key: 'process', label: 'Workspace', icon: LayoutGrid },
  { key: 'files', label: 'Files', icon: FolderOpen },
  { key: 'settings', label: 'Settings', icon: Settings2 },
] as const;

export default function App() {
  const controller = useCompression();
  const { workerReady, isProcessing, result, cancel, download } =
    controller;
  const recent = useAppStore((state) => state.recentArchives);
  const outputs = useAppStore(state => state.sessionOutputs);
  const localCount = new Set([...recent.map(entry => entry.id), ...Object.values(outputs).filter(output => !output.hidden).map(output => output.archive.id)]).size;
  const { privacyChoice, setPrivacyChoice } = usePreferences();
  const [{ view, section }, setRoute] = useState(readRoute);
  useEffect(() => { if (privacyChoice === 'learning') setPrivacyChoice('essential'); }, [privacyChoice, setPrivacyChoice]);
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const [announcement, setAnnouncement] = useState('');
  const [jobCount, setJobCount] = useState(0);
  useEffect(() => {
    const notify = (event: Event) => {
      setAnnouncement((event as CustomEvent<{ message: string }>).detail.message);
    };
    const count = (event: Event) => setJobCount((event as CustomEvent<number>).detail);
    const clearOwner = () => { setAnnouncement(''); setJobCount(0); };
    window.addEventListener('hamma-owner-clearing', clearOwner);
    window.addEventListener('hamma-job-notice', notify);
    window.addEventListener('hamma-job-count', count);
    return () => { window.removeEventListener('hamma-owner-clearing', clearOwner); window.removeEventListener('hamma-job-notice', notify); window.removeEventListener('hamma-job-count', count); };
  }, []);

  const navigate = useCallback((next: View, section: SettingsSection = 'general') => {
    const url = new URL(window.location.href);
    if (next === 'process') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    if (next === 'settings' && section !== 'general') url.searchParams.set('section', section);
    else url.searchParams.delete('section');
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
    setRoute({ view: next, section });
  }, []);
  const openSettings = (next: SettingsSection) => navigate('settings', next);
  const activeTab = view === 'overview' ? 'files' : view === 'account' ? 'settings' : view;
  useEffect(() => {
    const restore = () => setRoute(readRoute());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view]);
  const selectFiles = useCallback(
    async (files: File[], restore = true) => {
      if (isProcessing || !workerReady || !files.length) return;
      if (files.length === 1) {
        return restore && /\.spk$/i.test(files[0].name)
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
      if (event.defaultPrevented || event.isComposing || target?.isContentEditable ||
          target?.closest?.('input,textarea,select,[aria-modal="true"]'))
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'o' &&
        !isProcessing
      ) {
        event.preventDefault();
        // Mount the picker while the keyboard event still carries user activation.
        if (view !== 'process') flushSync(() => navigate('process'));
        mainRef.current?.querySelector<HTMLButtonElement>('[data-open-file-picker]')?.click();
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
  }, [view, isProcessing, result, cancel, download, navigate]);

  return (
    <div
      className="hamma-shell"
    >
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Application sidebar">
        <button
          className="brand"
          onClick={() => navigate('process')}
          aria-label="HAMMA workspace"
        >
          <span className="brand-symbol">
            <FileArchive size={21} strokeWidth={1.6} />
          </span>
          <strong>HAMMA</strong>
        </button>
        <nav className="primary-navigation" aria-label="Main navigation">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              aria-label={label}
              aria-current={activeTab === key ? 'page' : undefined}
              onClick={() => navigate(key)}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{label}</span>
              {key === 'files' && localCount + jobCount > 0 && (
                <small aria-hidden="true">{localCount + jobCount}</small>
              )}
              {key === 'process' && isProcessing && (
                <span className="running-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="watermark">
            <span>By Onazi Treasure Oj</span>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          HAMMA
        </header>
        <main
          id="workspace-main"
          ref={mainRef}
          tabIndex={-1}
          className="workspace-main"
        >
          <UniversalWorkspace
            spkReady={workerReady}
            spkBusy={isProcessing}
            onSpkSelect={async (files, restore) => { await selectFiles(files, restore); return useAppStore.getState().operationStatus === 'completed'; }}
            spkStatus={isProcessing ? <div className="upload-status" role="status"><Loader2 size={16} className="animate-spin" /><span>{controller.progress.phase || 'Processing SPK'}<small>{controller.selectedFile?.name}</small></span><progress aria-label="SPK progress" value={controller.progress.bytesProcessed} max={Math.max(1, controller.progress.totalBytes)} /><button className="icon-button" aria-label="Cancel SPK operation" onClick={cancel}>Cancel</button></div> : controller.isError ? <div className="processor-notice" role="alert">{controller.error}<button className="text-button" onClick={controller.reset}>Dismiss</button></div> : null}
            spkResult={result}
            onSpkDownload={download}
            visible={view === 'process' || view === 'files'}
            screen={view === 'files' ? 'history' : 'workspace'}
            onHistory={() => navigate('files')}
            onWorkspace={() => navigate('process')}
            onOverview={() => navigate('overview')}
          />
              {view === 'account' && <AccountPanel />}
              {view === 'overview' && (
                <LocalOverview
                  onHistory={() => navigate('files')}
                />
              )}
              {view === 'settings' && (
                <SettingsPanel
                  section={section}
                  onSectionChange={openSettings}
                  busy={isProcessing}
                  onHistory={() => navigate('files')}
                  onAccount={() => navigate('account')}
                />
              )}
        </main>
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
