import { useAppStore } from '../../store/app';
import { formatFileSize } from '../../utils/fileHelpers';

/** Local operation records; archive contents are never persisted here. */
export function ActivityHistory() {
  const entries = useAppStore(state => state.recentArchives);
  const clearHistory = useAppStore(state => state.clearRecentArchives);
  return (
    <section className="max-w-4xl mx-auto w-full" aria-labelledby="activity-title">
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 id="activity-title" className="text-xl font-semibold">Activity</h2>
        <button className="ios-btn-secondary" disabled={entries.length === 0} onClick={clearHistory}>Clear history</button>
      </div>
      <p className="text-sm text-muted mb-5">The last 20 completed operations on this browser. Records contain metadata only; download each result when it completes.</p>
      {entries.length === 0 ? (
        <p role="status" className="ios-card text-sm text-muted">No completed operations yet. Compress or restore a file to see it here.</p>
      ) : (
        <div className="ios-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted border-b border-border">
              <tr><th className="p-2 font-medium">File</th><th className="p-2 font-medium">Operation</th><th className="p-2 font-medium">Input</th><th className="p-2 font-medium">Output</th><th className="p-2 font-medium">Completed</th></tr>
            </thead>
            <tbody>{entries.map(entry => (
              <tr key={entry.id} className="border-b border-border last:border-0">
                <td className="p-2 max-w-[240px] break-words">{entry.fileName}</td>
                <td className="p-2">{entry.type === 'compress' ? 'Compression' : 'Restoration'}</td>
                <td className="p-2 whitespace-nowrap">{formatFileSize(entry.originalSize)}</td>
                <td className="p-2 whitespace-nowrap">{formatFileSize(entry.compressedSize)}</td>
                <td className="p-2 whitespace-nowrap"><time dateTime={new Date(entry.date).toISOString()}>{new Date(entry.date).toLocaleString()}</time></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
