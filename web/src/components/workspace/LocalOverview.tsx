import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/app';
import { activeJob, type Job } from '../../processing/client';
import { combineActivity, loadJobs } from '../../processing/activity';
import { formatFileSize } from '../../utils/fileHelpers';
import type { DeviceInfo } from '../../hooks/useCompression';

export function LocalOverview({ device, onHistory }: {
  device: DeviceInfo | null;
  onHistory: () => void;
}) {
  const recent = useAppStore(state => state.recentArchives);
  const outputs = useAppStore(state => state.sessionOutputs);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const records = await loadJobs(controller.signal);
        if (!disposed) { setJobs(records); setStatus('ready'); }
      } catch { if (!disposed) setStatus('offline'); }
      if (!disposed) timer = setTimeout(refresh, 10000);
    };
    void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [attempt]);
  useEffect(() => {
    const changed = (event: Event) => { setJobs((event as CustomEvent<Job[]>).detail); setStatus('ready'); };
    const connection = (event: Event) => { const value = (event as CustomEvent<string>).detail; if (value === 'offline') setStatus('offline'); };
    window.addEventListener('hamma-jobs-updated', changed); window.addEventListener('hamma-processor-status', connection);
    return () => { window.removeEventListener('hamma-jobs-updated', changed); window.removeEventListener('hamma-processor-status', connection); };
  }, []);
  const all = combineActivity(jobs, recent, outputs);
  const completed = all.filter(job => job.state === 'completed');
  const compressions = completed.filter(job => job.operation === 'compress' && job.outputSize !== null);
  const input = compressions.reduce((sum, job) => sum + job.inputSize, 0);
  const output = compressions.reduce((sum, job) => sum + job.outputSize!, 0);
  const saved = input - output;
  const active = all.filter(activeJob).length;
  const failed = all.filter(job => ['failed', 'interrupted'].includes(job.state)).length;
  const latest = [...all].sort((a, b) => b.created - a.created).slice(0, 5);
  return <section className="overview-page">
    <div className="page-heading"><div><h1>Overview</h1><p className="page-description">Your files, activity, and measured space savings.</p></div><button className="button secondary" onClick={onHistory}>View history <ArrowRight size={15} /></button></div>
    {status === 'offline' && <div className="processor-notice" role="status"><span>Processor unavailable. Showing browser records and the last loaded jobs.</span><button className="button secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} /> Retry</button></div>}
    {status === 'loading' && <p className="footnote" role="status">Loading activity…</p>}
    <div className="overview-grid">
      <Metric label="Operations" value={String(all.length)} detail={`${completed.length} completed · ${active} active · ${failed} need attention`} />
      <Metric label="Compression input" value={formatFileSize(input)} detail={`${compressions.length} completed compression jobs`} />
      <Metric label={saved >= 0 ? 'Space saved' : 'Archive overhead'} value={formatFileSize(Math.abs(saved))} detail={input ? `${(Math.abs(saved) / input * 100).toFixed(1)}% of compression input` : 'Savings appear after your first compression'} />
    </div>
    <div className="overview-panels">
      <section className="surface settings-group"><div className="section-heading"><h2>Activity by operation</h2><p>Completed jobs across standard formats and SPK.</p></div>
        <div className="operation-breakdown">{(['compress', 'extract', 'convert'] as const).map(operation => {
          const count = completed.filter(job => job.operation === operation).length;
          return <div key={operation}><span className={`operation-tag tag-${operation}`}>{operation === 'compress' ? 'Compression' : operation === 'extract' ? 'Extraction' : 'Conversion'}</span><meter aria-label={`${operation} share`} min={0} max={Math.max(1, completed.length)} value={count} /><strong>{count}</strong></div>;
        })}</div>
      </section>
      <section className="surface settings-group"><div className="section-heading"><h2>Workspace status</h2><p>{status === 'ready' ? 'Processor connected' : status === 'offline' ? 'Processor disconnected' : 'Connecting to processor'}</p></div><dl className="overview-status"><dt>In progress</dt><dd>{active}</dd><dt>Needs attention</dt><dd>{failed}</dd><dt>Browser engine</dt><dd>{device ? `${device.platform} · ${device.cores} processors` : 'Initializing'}</dd></dl><p className="footnote">History belongs to this browser session. Shared links let each person work with their own files.</p></section>
    </div>
    <section className="surface settings-group"><div className="section-line"><h2>Recent activity</h2><button className="text-button" onClick={onHistory}>See all <ArrowRight size={14} /></button></div>{latest.length ? <div className="overview-recent">{latest.map(job => <button key={job.id} onClick={onHistory}><span className={`operation-tag tag-${job.operation}`}>{job.operation}</span><span><strong>{job.outputName || job.name}</strong><small>{new Date(job.created * 1000).toLocaleString()}</small></span><span className={`file-state state-${job.state}`}>{job.state}</span></button>)}</div> : <p className="footnote">Add files in Workspace to start your first operation.</p>}</section>
    <p className="footnote">Totals cover retained processor jobs, browser records, and visible SPK outputs in this session. Savings count completed compressions only; extraction and conversion do not inflate them.</p>
  </section>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric surface"><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>;
}
