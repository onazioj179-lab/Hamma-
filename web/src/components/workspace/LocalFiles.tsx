import { ArrowRight, Download, FileArchive, FolderOpen } from 'lucide-react';
import { formatFileSize } from '../../utils/fileHelpers';
import type { CompressionController } from './CompressionWorkspace';

export function LocalFiles({
  controller,
  onWorkspace,
}: {
  controller: CompressionController;
  onWorkspace: () => void;
}) {
  const { result, isProcessing, download } = controller;
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLOSE AT HAND</p>
          <h1>My files</h1>
          <p className="page-description">
            Your current result. Ready for its next home.
          </p>
        </div>
      </div>
      <div className="surface">
        {result && !isProcessing ? (
          <div className="current-file">
            <span className="file-tile">
              <FileArchive size={24} />
            </span>
            <div>
              <h2>{result.outputName}</h2>
              <p>
                {formatFileSize(result.resultSize)} ·{' '}
                {result.downloadUrl
                  ? 'Available in this session'
                  : 'Saved directly to your device'}
              </p>
            </div>
            {result.downloadUrl && (
              <button className="button primary" onClick={download}>
                <Download size={15} />
                Download
              </button>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <FolderOpen size={25} />
            <h2>
              {isProcessing
                ? 'Your result is on its way.'
                : 'A place for your next result.'}
            </h2>
            <p>
              {isProcessing
                ? 'Your file is processing in Workspace.'
                : 'Compress or restore a file to make a downloadable result here.'}
            </p>
            <button className="button primary" onClick={onWorkspace}>
              Go to workspace <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
      <p className="footnote">
        This is a local tool, not cloud storage. Results stay in memory for this
        session. Your browser saves downloads to the location you choose.
      </p>
    </section>
  );
}
