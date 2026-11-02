import { useState } from 'react';
import { ArrowUpRight, Check, Monitor, Moon, Sun } from 'lucide-react';
import { useAppStore, type Theme } from '../../store/app';
import { clearApplicationCache, usePreferences } from '../../store/preferences';

export type SettingsSection = 'general' | 'privacy' | 'storage' | 'about';
interface Props {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  busy: boolean;
}
export function SettingsPanel({ section, onSectionChange, busy }: Props) {
  const {
    theme,
    setTheme,
    autoDownload,
    setAutoDownload,
    recentArchives,
    clearRecentArchives,
  } = useAppStore();
  const {
    privacyChoice,
    setPrivacyChoice,
    rememberHistory,
    setRememberHistory,
    learning,
    clearLearning,
  } = usePreferences();
  const [message, setMessage] = useState('');
  const [clearing, setClearing] = useState(false);
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
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>{section === 'about' ? 'Made with purpose.' : 'Settings'}</h1>
          <p className="page-description">
            Simple controls. Clear choices. Everything in one place.
          </p>
        </div>
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
              <p>A familiar space, in your preferred light.</p>
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
              description="Download a result as soon as compression or restoration finishes."
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
              <h2>Your files stay with you.</h2>
              <p>
                The workspace processes files on the computer running HAMMA. It does not
                send files to third parties or send analytics. Standard archive
                and media jobs use temporary storage on this device.
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
                A temporary session cookie protects local processing jobs.
                Essential browser storage remembers appearance, download
                preferences, and your privacy choice. History has separate retention controls.
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => {
                setPrivacyChoice('essential');
                setMessage(
                  'Essential storage selected. Local learning is off and its data is cleared.',
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
              description={`${recentArchives.length} of 20 records stored. File contents are never saved in history.`}
              label="Clear history"
              disabled={!recentArchives.length}
              onClick={() => {
                clearRecentArchives();
                setMessage(
                  'History cleared. Downloaded files were not changed.',
                );
              }}
            />
            <SettingAction
              title="Application cache"
              description="Clear only HAMMA-owned Cache Storage entries. This does not clear your browser cache or other sites."
              label={clearing ? 'Clearing…' : 'Clear app cache'}
              disabled={busy || clearing}
              onClick={clearCache}
            />
          </section>
          <p className="footnote">
            SPK results stay available until you start another job or close the
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
                Files are processed on this device. Standard jobs continue while
                you move between screens, and results remain available until
                their expiry. Compression savings depend on the file.
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
