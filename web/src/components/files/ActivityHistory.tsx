import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  Search,
  Trash2,
} from 'lucide-react';
import { useAppStore, type RecentArchive } from '../../store/app';
import { formatFileSize } from '../../utils/fileHelpers';

export function OperationRows({
  entries,
  removable = false,
}: {
  entries: RecentArchive[];
  removable?: boolean;
}) {
  const remove = useAppStore((state) => state.removeRecentArchive);
  return (
    <div className="operation-list">
      {entries.map((entry) => {
        const restore = entry.type === 'decompress';
        const date = new Date(entry.date);
        return (
          <div className="operation-row" key={entry.id}>
            <span className="operation-icon" aria-hidden="true">
              {restore ? (
                <ArrowDownLeft size={17} />
              ) : (
                <ArrowUpRight size={17} />
              )}
            </span>
            <div className="operation-name">
              <strong title={entry.fileName}>{entry.fileName}</strong>
              <span>
                {restore ? 'Restored' : 'Compressed'} ·{' '}
                {Number.isNaN(date.getTime())
                  ? 'Date unavailable'
                  : date.toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
              </span>
            </div>
            <div className="operation-sizes">
              <strong>
                {formatFileSize(
                  restore ? entry.originalSize : entry.compressedSize,
                )}
              </strong>
              <span>
                from{' '}
                {formatFileSize(
                  restore ? entry.compressedSize : entry.originalSize,
                )}
              </span>
            </div>
            {removable && (
              <button
                className="icon-button"
                aria-label={`Remove ${entry.fileName} from history`}
                onClick={() => remove(entry.id)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function ActivityHistory() {
  const entries = useAppStore((state) => state.recentArchives);
  const clearHistory = useAppStore((state) => state.clearRecentArchives);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const visible = entries.filter(
    (entry) =>
      entry.fileName.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' || entry.type === filter),
  );
  return (
    <section className="history-page" aria-labelledby="activity-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORK, IN ORDER</p>
          <h1 id="activity-title">History</h1>
          <p className="page-description">
            The last 20 completed operations on this browser.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!entries.length}
          onClick={clearHistory}
        >
          Clear history
        </button>
      </div>
      <div className="surface">
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search history"
              placeholder="Search file names"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Filter history"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All operations</option>
            <option value="compress">Compression</option>
            <option value="decompress">Restoration</option>
          </select>
        </div>
        {visible.length ? (
          <OperationRows entries={visible} removable />
        ) : (
          <div role="status" className="empty-state">
            <Clock3 size={23} />
            <h2>
              {entries.length ? 'No matching operations' : 'A fresh start.'}
            </h2>
            <p>
              {entries.length
                ? 'Try another file name or operation filter.'
                : 'No completed operations yet. Your next compression or restoration will appear here.'}
            </p>
          </div>
        )}
      </div>
      <p className="footnote">
        History contains metadata only. Download each result when it completes;
        file contents are not stored here.
      </p>
    </section>
  );
}
