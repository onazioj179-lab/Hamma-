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
          <h1>SPK overview</h1>
          <p className="page-description">
            SPK archive measurements from this browser. Standard file jobs are
            listed in History.
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
