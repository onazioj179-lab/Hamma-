import { ArrowRight } from 'lucide-react';
import { useAppStore } from '../../store/app';
import { usePreferences } from '../../store/preferences';
import { formatFileSize } from '../../utils/fileHelpers';
import type { DeviceInfo } from '../../hooks/useCompression';

export function LocalOverview({
  device,
  onPrivacy,
}: {
  device: DeviceInfo | null;
  onPrivacy: () => void;
}) {
  const recent = useAppStore((state) => state.recentArchives);
  const { learning, privacyChoice } = usePreferences();
  const completed = recent.filter((entry) => entry.type === 'compress');
  const input = completed.reduce((sum, entry) => sum + entry.originalSize, 0);
  const output = completed.reduce(
    (sum, entry) => sum + entry.compressedSize,
    0,
  );
  const saved = input - output;
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE SMALL THINGS ADD UP</p>
          <h1>Your overview</h1>
          <p className="page-description">
            Measured from the records on this browser.
          </p>
        </div>
      </div>
      <div className="overview-grid">
        <Metric
          label="Recorded operations"
          value={String(recent.length)}
          detail="Up to 20 recent records"
        />
        <Metric
          label="Files compressed"
          value={formatFileSize(input)}
          detail={`${completed.length} recorded compression jobs`}
        />
        <Metric
          label={saved >= 0 ? 'Space saved' : 'Archive overhead'}
          value={formatFileSize(Math.abs(saved))}
          detail={
            input
              ? `${((Math.abs(saved) / input) * 100).toFixed(1)}% of recorded input`
              : 'Complete a compression to measure savings'
          }
        />
      </div>
      <section className="surface settings-group">
        <div className="section-heading">
          <h2>Local performance learning</h2>
          <p>
            {privacyChoice === 'learning'
              ? 'Enabled on this browser. Only aggregate sizes and times are retained.'
              : 'Off by default. You choose whether HAMMA remembers aggregate performance.'}
          </p>
        </div>
        {learning.samples > 0 ? (
          <div className="learning-grid">
            <Metric
              label="Observations"
              value={String(learning.samples)}
              detail="Most recent rolling measurements"
            />
            <Metric
              label="Typical throughput"
              value={`${formatFileSize((learning.inputBytes / Math.max(1, learning.durationMs)) * 1000)}/s`}
              detail="Input bytes divided by measured time"
            />
          </div>
        ) : (
          <p className="footnote">
            No local measurements yet. Enable learning to see observed
            performance.
          </p>
        )}
        <button className="button secondary" onClick={onPrivacy}>
          Manage privacy <ArrowRight size={14} />
        </button>
      </section>
      <section className="surface settings-group">
        <div className="section-heading">
          <h2>This device</h2>
          <p>
            {device
              ? `${device.cores} logical processors · ${device.platform} · ${device.hasWorkers ? 'Workers available' : 'Main-thread processing'}`
              : 'Device information unavailable.'}
          </p>
        </div>
        <p className="footnote">
          Measurements reflect this browser and workload. They are not a
          throughput guarantee.
        </p>
      </section>
    </section>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric surface">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
