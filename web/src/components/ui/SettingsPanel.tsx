import { useState } from 'react';
import { ArrowUpRight, Check, Monitor, Moon, Sun } from 'lucide-react';
import { useAppStore, type Theme } from '../../store/app';
import { clearApplicationCache, usePreferences } from '../../store/preferences';
import { ConfirmAction, type ConfirmationRequest } from './ConfirmAction';

export type SettingsSection = 'general' | 'privacy' | 'storage' | 'about';
interface Props {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  busy: boolean;
  onHistory?: () => void;
}
export function SettingsPanel({ section, onSectionChange, busy, onHistory }: Props) {
  const {
    theme,
    setTheme,
    autoDownload,
    setAutoDownload,
    recentArchives,
    history,
    removeRecentArchive,
    sessionOutputs,
    deleteSessionOutput,
  } = useAppStore();
  const {
    setPrivacyChoice,
    rememberHistory,
    setRememberHistory,
  } = usePreferences();
  const outputCount = Object.values(sessionOutputs).filter(output => output.downloadUrl).length;
  const [message, setMessage] = useState('');
  const [clearing, setClearing] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const confirmHistory = () => {
    const current = useAppStore.getState();
    const ids = [...new Set([...current.recentArchives.map(entry => entry.id), ...Object.entries(current.sessionOutputs).filter(([, output]) => !output.hidden).map(([id]) => id)])];
    const legacy = (Array.isArray(current.history) ? current.history : []).map(entry => entry.id);
    setConfirmation({
      title: `Clear ${(ids.length + legacy.length).toLocaleString()} browser activity ${ids.length + legacy.length === 1 ? 'record' : 'records'}?`,
      description: 'Stored downloads, processor history and copies on your device stay. Clearing these browser records cannot be undone.',
      confirmLabel: 'Clear history',
      onConfirm: () => {
        ids.forEach(id => removeRecentArchive(id));
        legacy.forEach(id => useAppStore.getState().removeHistoryEntry(id));
        setMessage('Browser history cleared. Stored downloads and downloaded files were kept.');
      },
    });
  };
  const confirmFiles = () => {
    const ids = Object.entries(useAppStore.getState().sessionOutputs).filter(([, output]) => output.downloadUrl).map(([id]) => id);
    setConfirmation({
      title: `Delete ${ids.length.toLocaleString()} temporary browser ${ids.length === 1 ? 'download' : 'downloads'}?`,
      description: 'These files will no longer be available from this browser session. History, processor files and downloaded copies on your device stay. This deletion cannot be undone.',
      confirmLabel: 'Delete browser files',
      onConfirm: () => { ids.forEach(id => deleteSessionOutput(id)); setMessage('Temporary browser files deleted. History and downloaded copies were kept.'); },
    });
  };
  const clearCache = async () => {
    setClearing(true);
    setMessage('');
    try {
      const count = await clearApplicationCache();
      setMessage(
        count
          ? `Cleared ${count} application caches.`
          : 'No application caches to clear.',
      );
    } catch {
      setMessage('The browser could not clear application caches. Try again.');
    } finally {
      setClearing(false);
    }
  };
  return (
    <div className="settings-page">
      <div className="page-heading">
        <h1>{section === 'about' ? 'About HAMMA' : 'Settings'}</h1>
      </div>
      <nav className="settings-tabs" aria-label="Settings sections">
        {(['general', 'privacy', 'storage', 'about'] as const).map((item) => (
          <button
            key={item}
            aria-current={section === item ? 'page' : undefined}
            onClick={() => {
              onSectionChange(item);
              setMessage('');
            }}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      {section === 'general' && (
        <>
          <section className="surface settings-group">
            <div className="section-heading">
              <h2>Appearance</h2>
              <p>Choose light, dark, or match your device.</p>
            </div>
            <div className="appearance-options">
              {[
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'system', label: 'System', icon: Monitor },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value as Theme)}
                >
                  <span className={`appearance-preview preview-${value}`}>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="appearance-label">
                    <Icon size={15} />
                    {label}
                    {theme === value && <Check size={14} />}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="surface settings-group">
            <SettingSwitch
              label="Automatic SPK downloads"
              description="Download a result as soon as compression or restoration finishes. If your browser blocks automatic downloads, use the file’s download link in History."
              checked={autoDownload}
              onChange={setAutoDownload}
            />
            <div className="setting-detail">
              <span>SPK processing</span>
              <strong>One SPK job at a time</strong>
              <p>
                Prevents overlapping operations from replacing your result.
                Standard file jobs use a separate background queue.
              </p>
            </div>
          </section>
        </>
      )}
      {section === 'privacy' && (
        <>
          <section className="surface settings-group">
            <div className="section-heading">
              <h2>Where your files are processed</h2>
              <p>
                Standard archive and media jobs run on the computer hosting HAMMA.
                File detection sends up to 512 bytes per selected file to that computer.
                SPK operations run in this browser. Files are not sent to external AI services.
              </p>
            </div>
            <SettingSwitch
              label="Remember SPK history"
              description="Keep the last 20 completed operation records, including file names, on this browser. Turning this off stops new records; existing records can be cleared in Storage."
              checked={rememberHistory}
              onChange={setRememberHistory}
            />
          </section>
          <section className="surface settings-group">
            <div className="section-heading">
              <h2>Cookies & local storage</h2>
              <p>
                A guest session cookie protects local processing jobs. Signing in
                adds an account cookie that expires after one day. Account
                passwords are stored as hashes on the processor computer.
                Essential browser storage remembers appearance, download
                preferences, and your privacy choice. History has separate retention controls.
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => {
                setPrivacyChoice('essential');
                setMessage(
                  'Essential storage selected.',
                );
              }}
            >
              Use essential storage only
            </button>
          </section>
        </>
      )}
      {section === 'storage' && (
        <>
          <section className="surface settings-group">
            <div className="section-heading">
              <h2>Keep a clean workspace.</h2>
              <p>
                These controls affect HAMMA data on this browser. Your
                downloaded files remain on disk.
              </p>
            </div>
            <SettingAction
              title="SPK operation history"
              description={`${recentArchives.length} of 20 records stored. Records contain metadata only. Clearing history keeps temporary output files available through the Available downloads filter.`}
              label="Clear history"
              disabled={busy || (!recentArchives.length && !history.length && !Object.values(sessionOutputs).some(output => !output.hidden))}
              onClick={confirmHistory}
            />
            <SettingAction
              title="Temporary SPK downloads"
              description={`${outputCount} output files available in this session. Delete them to release browser memory; downloaded copies stay on your device.`}
              label="Delete browser files"
              disabled={busy || !outputCount}
              onClick={confirmFiles}
            />
            {onHistory && <SettingAction title="Processor files & retention" description="Manage standard job downloads, history, and expiry in the shared file history." label="Manage files" disabled={false} onClick={onHistory} />}
            <SettingAction
              title="Application cache"
              description="Clear only HAMMA-owned Cache Storage entries. This does not clear your browser cache or other sites."
              label={clearing ? 'Clearing…' : 'Clear app cache'}
              disabled={busy || clearing}
              onClick={clearCache}
            />
          </section>
          <p className="footnote">
            SPK results stay available until you delete them or close the
            page. Standard file jobs use the retention controls in History.
          </p>
        </>
      )}
      {section === 'about' && (
        <>
          <section className="surface about-card">
            <div className="about-monogram" aria-hidden="true">
              H
            </div>
            <p className="eyebrow">HAMMA · SINGULARITY PACK</p>
            <h2>
              A little less space.
              <br />A lot more intention.
            </h2>
            <p>
              A free, local workspace for compression, extraction, and media
              conversion. Built to make a technical task feel simple.
            </p>
            <div className="creator-credit">
              <span>CREATED BY</span>
              <strong>Onazi Treasure Oj</strong>
            </div>
            <a
              className="button secondary"
              href="https://github.com/onazioj179-lab/Hamma-"
              target="_blank"
              rel="noreferrer"
            >
              Explore the project <ArrowUpRight size={14} />
            </a>
          </section>
          <section className="surface settings-group">
            <div className="section-heading">
              <h2>How it works</h2>
              <p>
                Standard jobs continue while the processor service is running, including
                when you move between screens. Their downloads follow the file retention
                settings. Temporary SPK downloads remain in the open browser session.
                Compression can make some files larger; savings depend on the contents.
              </p>
            </div>
            <p className="footnote">Free to use · Open source · MIT license</p>
          </section>
        </>
      )}
      {message && (
        <p role="status" className="inline-notice">
          {message}
        </p>
      )}
      {confirmation && <ConfirmAction {...confirmation} onCancel={() => setConfirmation(null)} />}
    </div>
  );
}
export function SettingSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="preference-row">
      <span>
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}
function SettingAction({
  title,
  description,
  label,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="setting-action">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <button
        className="button secondary"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}
