import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/app';
import { combineActivity, loadOverview, summarizeActivity, type ActivityOverview } from '../../processing/activity';
import { formatFileSize } from '../../utils/fileHelpers';

export function LocalOverview({ onHistory }: {
  onHistory: () => void;
}) {
  const recent = useAppStore(state => state.recentArchives);
  const outputs = useAppStore(state => state.sessionOutputs);
  const [overview, setOverview] = useState<ActivityOverview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const records = await loadOverview(controller.signal);
        if (!disposed) { setOverview(records); setStatus('ready'); }
      } catch { if (!disposed) setStatus('offline'); }
      if (!disposed) timer = setTimeout(refresh, 10000);
    };
    const clearOwner = () => { disposed = true; controller.abort(); clearTimeout(timer); setOverview(null); setStatus('loading'); };
    const ownerChanged = () => setAttempt(value => value + 1);
    window.addEventListener('hamma-owner-clearing', clearOwner);
    window.addEventListener('hamma-owner-changed', ownerChanged);
    void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); window.removeEventListener('hamma-owner-clearing', clearOwner); window.removeEventListener('hamma-owner-changed', ownerChanged); };
  }, [attempt]);
  const local = combineActivity([], recent, outputs);
  const localMetrics = summarizeActivity(local);
  const server = overview?.metrics;
  const operations = localMetrics.total + (server?.total ?? 0);
  const completed = localMetrics.completed + (server?.completed ?? 0);
  const active = server?.active ?? 0;
  const failed = server?.failed ?? 0;
  const measured = localMetrics.measured + (server?.measured ?? 0);
  const input = localMetrics.input + (server?.input ?? 0);
  const output = localMetrics.output + (server?.output ?? 0);
  const saved = input - output;
  const counts = {
    compress: localMetrics.compressed + (server?.compressed ?? 0),
    extract: localMetrics.extracted + (server?.extracted ?? 0),
    convert: localMetrics.converted + (server?.converted ?? 0),
  };
  const latest = [...(overview?.jobs ?? []), ...local]
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id)).slice(0, 5);
  return <section className="overview-page">
    <div className="page-heading"><div><h1>Overview</h1></div><button className="button secondary" onClick={onHistory}>Files &amp; History <ArrowRight size={15} /></button></div>
    {status === 'offline' && <div className="processor-notice" role="status"><span>Processor unavailable. Showing browser records and the last loaded jobs.</span><button className="button secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} /> Retry</button></div>}
    {status === 'loading' && <p className="footnote" role="status">Loading activity…</p>}
    <div className="overview-grid">
      <Metric label="Operations" value={String(operations)} detail={`${completed} completed · ${active} active · ${failed} need attention`} />
      <Metric label="Compression input" value={formatFileSize(input)} detail={`${measured} completed compression jobs`} />
      <Metric label={saved >= 0 ? 'Space saved' : 'Archive overhead'} value={formatFileSize(Math.abs(saved))} detail={input ? `${(Math.abs(saved) / input * 100).toFixed(1)}% of compression input` : 'Savings appear after your first compression'} />
    </div>
    <div className="overview-panels">
      <section className="surface settings-group"><div className="section-heading"><h2>Activity by operation</h2></div>
        <div className="operation-breakdown">{(['compress', 'extract', 'convert'] as const).map(operation => {
          const count = counts[operation];
          return <div key={operation}><span className={`operation-tag tag-${operation}`}>{operation === 'compress' ? 'Compression' : operation === 'extract' ? 'Extraction' : 'Conversion'}</span><meter aria-label={`${operation} share`} min={0} max={Math.max(1, completed)} value={count} /><strong>{count}</strong></div>;
        })}</div>
      </section>
      <section className="surface settings-group"><div className="section-heading"><h2>Workspace status</h2><p>{status === 'ready' ? 'Processor connected' : status === 'offline' ? 'Processor disconnected' : 'Connecting to processor'}</p></div><dl className="overview-status"><dt>In progress</dt><dd>{active}</dd><dt>Needs attention</dt><dd>{failed}</dd></dl></section>
    </div>
    <section className="surface settings-group"><div className="section-line"><h2>Recent activity</h2><button className="text-button" onClick={onHistory}>See all <ArrowRight size={14} /></button></div>{latest.length ? <div className="overview-recent">{latest.map(job => <button key={job.id} onClick={onHistory}><span className={`operation-tag tag-${job.operation}`}>{job.operation}</span><span><strong>{job.outputName || job.name}</strong><small>{new Date(job.created * 1000).toLocaleString()}</small></span><span className={`file-state state-${job.state}`}>{job.state}</span></button>)}</div> : <p className="footnote">Add files in Workspace to start your first operation.</p>}</section>
    <p className="footnote">Totals cover retained processor jobs, browser records, and visible SPK outputs in this session. Savings count completed compressions only; extraction and conversion do not inflate them.</p>
  </section>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric surface"><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>;
}
