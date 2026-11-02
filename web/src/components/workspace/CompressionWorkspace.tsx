import {
  ArrowRight,
  Check,
  Download,
  FileArchive,
  History,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/app';
import { usePreferences } from '../../store/preferences';
import { useCompression } from '../../hooks/useCompression';
import { formatFileSize, formatDuration } from '../../utils/fileHelpers';
import { DropZoneCompact } from '../ui/DropZoneCompact';
import { OperationRows } from '../files/ActivityHistory';

export type CompressionController = ReturnType<typeof useCompression>;
export function CompressionWorkspace({
  controller,
  onSelect,
  onHistory,
}: {
  controller: CompressionController;
  onSelect: (files: File[]) => Promise<void>;
  onHistory: () => void;
}) {
  const {
    isIdle,
    isProcessing,
    isComplete,
    isError,
    progress,
    result,
    selectedFile,
    error,
    reset,
    cancel,
    download,
    currentStrategy,
  } = controller;
  const operationType = useAppStore((state) => state.operationType);
  const recent = useAppStore((state) => state.recentArchives);
  const rememberHistory = usePreferences((state) => state.rememberHistory);
  const engineLabel = isProcessing
    ? 'Active local engine'
    : isIdle
      ? 'Automatic selection'
      : currentStrategy?.includes('wasm')
        ? 'WebAssembly'
        : currentStrategy?.includes('worker')
          ? 'JavaScript worker'
          : 'JavaScript';
  const percent =
    progress.totalBytes > 0
      ? Math.max(
          0,
          Math.min(100, (progress.bytesProcessed / progress.totalBytes) * 100),
        )
      : 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE ROOM FOR MORE</p>
          <h1>
            Make space.
            <br />
            <span>Keep everything.</span>
          </h1>
          <p className="page-description">
            Compress files. Restore archives. All on your device.
          </p>
        </div>
        <span className="subtle-label">
          <ShieldCheck size={14} />
          Local by design
        </span>
      </div>
      <div className="workbench">
        <section
          className="surface compression-surface"
          aria-label="Compression workspace"
        >
          <div className="surface-heading">
            <span>
              <FileArchive size={16} />
              {operationType === 'decompress' && !isIdle
                ? 'Restore archive'
                : 'Compress & restore'}
            </span>
            <span className="format-label">SPK</span>
          </div>
          {isIdle && (
            <DropZoneCompact
              onFileSelect={(file) => onSelect([file])}
              onFilesSelect={onSelect}
              disabled={isProcessing}
            />
          )}
          {isProcessing && (
            <div className="job-panel" role="status" aria-live="polite">
              <span className="job-symbol">
                <Loader2 size={22} className="animate-spin" />
              </span>
              <h2>
                {operationType === 'decompress'
                  ? 'Restoring your file'
                  : 'Making a little space'}
              </h2>
              <p className="job-filename">{selectedFile?.name}</p>
              <div className="job-progress">
                <div>
                  <span>{progress.phase || 'Preparing'}</span>
                  <strong>{Math.floor(percent)}%</strong>
                </div>
                <progress
                  max={100}
                  value={percent}
                  aria-label="Operation progress"
                />
                <div>
                  <span>
                    {formatFileSize(progress.bytesProcessed)} of{' '}
                    {formatFileSize(progress.totalBytes)}
                  </span>
                  <span>
                    {progress.speed > 0
                      ? `${formatFileSize(progress.speed)}/s`
                      : 'Measuring…'}
                  </span>
                </div>
              </div>
              <button className="button secondary" onClick={cancel}>
                <X size={14} />
                Cancel operation
              </button>
            </div>
          )}
          {isComplete && result && (
            <div className="job-panel result-panel">
              <span className="job-symbol">
                <Check size={22} />
              </span>
              <p className="eyebrow">READY WHEN YOU ARE</p>
              <h2>
                {operationType === 'decompress'
                  ? 'Everything, restored.'
                  : 'Your archive is ready.'}
              </h2>
              <p className="job-filename">{result.outputName}</p>
              <div className="result-metrics">
                <div>
                  <span>Input</span>
                  <strong>{formatFileSize(result.originalSize)}</strong>
                </div>
                <ArrowRight size={15} />
                <div>
                  <span>Output</span>
                  <strong>{formatFileSize(result.resultSize)}</strong>
                </div>
                <div>
                  <span>Time</span>
                  <strong>{formatDuration(result.duration)}</strong>
                </div>
              </div>
              <p className="footnote">
                {operationType === 'decompress'
                  ? 'Your restored result is ready to download.'
                  : result.resultSize < result.originalSize
                    ? `${((1 - result.resultSize / Math.max(1, result.originalSize)) * 100).toFixed(1)}% smaller. Every byte preserved.`
                    : 'This file did not shrink. Already compressed files may grow slightly.'}
              </p>
              <div className="button-row">
                {result.downloadUrl ? (
                  <button className="button primary" onClick={download}>
                    <Download size={15} />
                    Download{' '}
                    {operationType === 'decompress' ? 'result' : 'archive'}
                  </button>
                ) : (
                  <span className="saved-label">
                    <Check size={15} />
                    Saved directly to your device
                  </span>
                )}
                <button className="button secondary" onClick={reset}>
                  Start another
                </button>
              </div>
            </div>
          )}
          {isError && (
            <div className="job-panel error-panel" role="alert">
              <span className="job-symbol">
                <X size={22} />
              </span>
              <h2>Let’s try that again.</h2>
              <p>{error || 'The operation could not finish.'}</p>
              <button className="button primary" onClick={reset}>
                Choose another file
              </button>
            </div>
          )}
        </section>
        <aside className="workbench-aside">
          <div className="aside-heading">
            <span className="small-symbol">
              <ShieldCheck size={17} />
            </span>
            <h2>
              A simpler kind
              <br />
              of file tool.
            </h2>
          </div>
          <p>
            No upload. No subscription. Just your files, with a little more
            room.
          </p>
          <div className="fact-list">
            <div>
              <span>Processing</span>
              <strong>On this device</strong>
            </div>
            <div>
              <span>File limit</span>
              <strong>5,000 per archive</strong>
            </div>
            <div>
              <span>Engine</span>
              <strong>{engineLabel}</strong>
            </div>
          </div>
          <div className="aside-tip">
            <FileArchive size={16} />
            <p>
              Have an SPK archive?
              <br />
              <strong>Drop it here to restore it.</strong>
            </p>
          </div>
        </aside>
      </div>
      <section className="recent-section">
        <div className="section-line">
          <h2>Recent activity</h2>
          <button className="text-button" onClick={onHistory}>
            View history <ArrowRight size={13} />
          </button>
        </div>
        {recent.length ? (
          <div className="surface">
            <OperationRows entries={recent.slice(0, 3)} />
          </div>
        ) : (
          <div className="recent-empty">
            <History size={17} />
            <p>
              {rememberHistory
                ? 'Your completed operations will appear here.'
                : 'History is off. You can enable it in Settings.'}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
