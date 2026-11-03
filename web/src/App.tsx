import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  HelpCircle,
  FileArchive,
  Files,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useCompression } from './hooks/useCompression';
import { useAppStore } from './store/app';
import { usePreferences } from './store/preferences';
import { browserStorage } from './store/storage';
import {
  SettingsPanel,
  type SettingsSection,
} from './components/ui/SettingsPanel';
import { LocalOverview } from './components/workspace/LocalOverview';
import { UniversalWorkspace } from './components/workspace/UniversalWorkspace';

const remoteServer = !['localhost', '127.0.0.1', '::1'].includes(location.hostname);

type View = 'process' | 'files' | 'overview' | 'settings';
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
  const outputs = useAppStore(state => state.sessionOutputs);
  const localCount = new Set([...recent.map(entry => entry.id), ...Object.values(outputs).filter(output => !output.hidden).map(output => output.archive.id)]).size;
  const { privacyChoice, setPrivacyChoice } = usePreferences();
  const [view, setView] = useState<View>('process');
  useEffect(() => { if (privacyChoice === 'learning') setPrivacyChoice('essential'); }, [privacyChoice, setPrivacyChoice]);
  const [section, setSection] = useState<SettingsSection>('general');
  const mainRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [jobCount, setJobCount] = useState(0);
  const [processorStatus, setProcessorStatus] = useState('connecting');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const notify = (event: Event) => {
      const message = (event as CustomEvent<{message: string}>).detail.message;
      setAnnouncement(message); setNotice(message);
      clearTimeout(timer); timer = setTimeout(() => setNotice(''), 8000);
    };
    const count = (event: Event) => setJobCount((event as CustomEvent<number>).detail);
    const connection = (event: Event) => setProcessorStatus((event as CustomEvent<string>).detail);
    window.addEventListener('hamma-processor-status', connection);
    window.addEventListener('hamma-job-notice', notify);
    window.addEventListener('hamma-job-count', count);
    return () => { clearTimeout(timer); window.removeEventListener('hamma-job-notice', notify); window.removeEventListener('hamma-job-count', count); window.removeEventListener('hamma-processor-status', connection); };
  }, []);

  const [termsAccepted, setTermsAccepted] = useState(() => browserStorage.getItem('hamma-terms-v1') === 'accepted');
  const openSettings = (next: SettingsSection) => {
    setSection(next);
    setView('settings');
  };
  useEffect(() => {
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
      if (target?.isContentEditable || target?.closest('input,textarea,select'))
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'o' &&
        !isProcessing
      ) {
        event.preventDefault();
        setView('process');
        document.querySelector<HTMLInputElement>('input[aria-label="Add files to queue"]')?.click();
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
      className="hamma-shell"
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
              {key === 'files' && localCount + jobCount > 0 && (
                <small>{localCount + jobCount}</small>
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
              className={processorStatus === 'ready' ? 'status-dot' : 'status-dot pending'}
            />
            {isProcessing ? 'Processing' : processorStatus === 'ready' ? 'Connected' : processorStatus === 'offline' ? workerReady ? 'Browser only' : 'Disconnected' : 'Connecting'}
            <span className="free-label">Free</span>
          </span>
        </header>
        <main
          id="workspace-main"
          ref={mainRef}
          tabIndex={-1}
          className="workspace-main"
        >
          {!termsAccepted && <aside className="processor-notice first-run-note" aria-label="File privacy"><div><strong>Your file privacy</strong><p>Standard jobs run on the computer hosting HAMMA. SPK runs in this browser. Each person has a separate file history.</p><button className="text-button" onClick={() => openSettings('privacy')}>Privacy details</button></div><button className="button secondary" onClick={() => { browserStorage.setItem('hamma-terms-v1', 'accepted'); setTermsAccepted(true); setPrivacyChoice('essential'); }}>Got it</button></aside>}
          <UniversalWorkspace
            spkReady={workerReady}
            spkBusy={isProcessing}
            onSpkSelect={async (files, restore) => { await selectFiles(files, restore); return useAppStore.getState().operationStatus === 'completed'; }}
            spkStatus={isProcessing ? <div className="upload-status" role="status"><Loader2 size={16} className="animate-spin" /><span>{controller.progress.phase || 'Processing SPK'}<small>{controller.selectedFile?.name}</small></span><progress aria-label="SPK progress" value={controller.progress.bytesProcessed} max={Math.max(1, controller.progress.totalBytes)} /><button className="icon-button" aria-label="Cancel SPK operation" onClick={cancel}>Cancel</button></div> : controller.isError ? <div className="processor-notice" role="alert">{controller.error}<button className="text-button" onClick={controller.reset}>Dismiss</button></div> : null}
            spkResult={result}
            onSpkDownload={download}
            visible={view === 'process' || view === 'files'}
            screen={view === 'files' ? 'history' : 'workspace'}
            onHistory={() => setView('files')}
          />
              {view === 'overview' && (
                <LocalOverview
                  device={deviceInfo}
                  onHistory={() => setView('files')}
                />
              )}
              {view === 'settings' && (
                <SettingsPanel
                  section={section}
                  onSectionChange={setSection}
                  busy={isProcessing}
                  onHistory={() => setView('files')}
                />
              )}
          <footer className="workspace-footer">
            <span>Made to make room.</span>
            <span>
              HAMMA <span aria-hidden="true">/</span> Onazi Treasure Oj
            </span>
          </footer>
        </main>
      </div>
      {notice && <aside className="job-toast" aria-label="Job update"><span>{notice}</span><button className="button secondary" onClick={() => { setView('files'); setNotice(''); }}>View files</button><button className="text-button" aria-label="Dismiss job update" onClick={() => setNotice('')}>Dismiss</button></aside>}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
