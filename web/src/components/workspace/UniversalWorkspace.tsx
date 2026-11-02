import { SelectField } from '../ui/SelectField';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRightLeft, Check, ChevronLeft, ChevronRight, Download, File, FileArchive, FolderPlus, History, Loader2, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { activeJob, droppedSources, jsonRequest, request, requestId, upload, type Capability, type Job, type Retention, type Source } from '../../processing/client';
import { formatFileSize } from '../../utils/fileHelpers';
import '../../processing/processing.css';

type Props = { visible: boolean; screen: 'workspace' | 'files' | 'history'; onHistory: () => void };
const terminal = (job: Job) => !activeJob(job);
const label = (state: string) => ({ queued: 'Waiting', paused: 'Paused', processing: 'Processing', verifying: 'Verifying', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }[state] || state);
const savings = (job: Job) => `${(Math.abs(1 - job.outputSize! / job.inputSize) * 100).toFixed(1)}% ${job.outputSize! <= job.inputSize ? 'smaller' : 'larger'}`;

export function UniversalWorkspace({ visible, screen, onHistory }: Props) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [offline, setOffline] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobSelected, setJobSelected] = useState(new Set<string>());
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const [target, setTarget] = useState('zip');
  const [conversion, setConversion] = useState('wav');
  const [recursive, setRecursive] = useState(false);
  const [retention, setRetention] = useState<Retention>({ historyRetention: '30d', fileRetention: '24h' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ name: string; offset: number; size: number } | null>(null);
  const [scroll, setScroll] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const queryRef = useRef({ page, query, filter, sort });
  queryRef.current = { page, query, filter, sort };
  const activity = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);

  const refresh = useCallback(async () => {
    const current = queryRef.current;
    const params = new URLSearchParams({ offset: String(current.page * 50), limit: '50', q: current.query, state: current.filter, sort: current.sort });
    const result = await request<{ jobs: Job[]; total: number }>('/jobs?' + params);
    if (mounted.current && current.page === queryRef.current.page && current.query === queryRef.current.query && current.filter === queryRef.current.filter && current.sort === queryRef.current.sort) {
      setJobs(result.jobs); setTotal(result.total);
      activity.current = result.jobs.some(activeJob);
    }
  }, []);
  const connect = useCallback(async () => {
    try {
      const caps = await request<Capability>('/capabilities');
      if (caps.processing !== 'local' || caps.version !== 1) throw new Error('Unavailable');
      setCapability(caps); setOffline(false);
      setRetention(await request<Retention>('/settings'));
    } catch { setOffline(true); }
  }, [refresh]);
  useEffect(() => { void connect(); }, [connect]);
  useEffect(() => {
    if (!capability) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); if (!disposed) setOffline(false); }
      catch { if (!disposed) setOffline(true); }
      if (!disposed) timer = setTimeout(poll, activity.current ? 1000 : 10000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [capability, refresh, page, query, filter, sort]);

  const add = (incoming: Source[]) => {
    if (!incoming.length) return;
    if (sources.length + incoming.length > (capability?.limits.files || 5000)) { setError('Too many files. Nothing was added.'); return; }
    const paths = new Set(sources.map(s => s.name.normalize('NFC').replace(/\\/g, '/').toLowerCase()));
    for (const source of incoming) {
      const name = source.name.normalize('NFC').replace(/\\/g, '/').toLowerCase();
      if (paths.has(name)) { setError('Duplicate filename. Nothing was added.'); return; }
      if (capability && source.size > capability.limits.input) { setError('File size limit reached. Nothing was added.'); return; }
      paths.add(name);
    }
    setError(''); setSources(previous => [...previous, ...incoming]);
    setSelected(previous => new Set([...previous, ...incoming.map(s => s.id)]));
  };
  const choose = (files: File[]) => add(files.map(file => ({ id: crypto.randomUUID(), file, name: file.webkitRelativePath || file.name, size: file.size, directory: false })));
  const chosen = sources.filter(source => selected.has(source.id));
  const submit = async (operation: 'compress' | 'extract' | 'convert') => {
    if (submitting.current || !chosen.length || !capability) return;
    submitting.current = true; setBusy(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    const submitted = new Set<string>();
    try {
      const inputs: { source: Source; id: string }[] = [];
      for (const source of chosen) {
        controller.signal.throwIfAborted();
        const id = await upload(source, controller.signal, offset => { source.uploaded = offset; setUploadStatus({ name: source.name, offset, size: source.size }); });
        inputs.push({ source, id });
        if (operation !== 'compress') {
          await jsonRequest('/jobs', { uploads: [id], operation, target: operation === 'extract' ? 'zip' : conversion, recursive, requestId: await requestId([source.id, operation, conversion, recursive]) });
          submitted.add(source.id);
        }
      }
      if (operation === 'compress') {
        await jsonRequest('/jobs', { uploads: inputs.map(i => i.id), operation, target, requestId: await requestId([inputs.map(i => i.source.id), operation, target]) });
        inputs.forEach(i => submitted.add(i.source.id));
      }
    } catch (caught) {
      setError(controller.signal.aborted ? 'Upload paused. Select an action to resume.' : caught instanceof Error ? caught.message : 'Could not queue files');
    } finally {
      setSources(previous => previous.filter(s => !submitted.has(s.id)));
      setSelected(previous => new Set([...previous].filter(id => !submitted.has(id))));
      setBusy(false); submitting.current = false; setUploadStatus(null);
      if (submitted.size) {
        setPage(0); setQuery(''); setFilter(''); setSort('newest');
        queryRef.current = { page:0, query:'', filter:'', sort:'newest' };
        void refresh().catch(() => {});
      }
    }
  };
  const action = async (job: Job, operation: string, method = 'POST') => {
    await request('/jobs/' + job.id + (operation ? '/' + operation : ''), { method });
  };
  const bulk = async (operation: string, method = 'POST') => {
    setError('');
    const chosenJobs = jobs.filter(j => jobSelected.has(j.id));
    const results = await Promise.allSettled(chosenJobs.map(j => action(j, operation, method)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length) setError(`${failed.length} action(s) failed: ${failed[0].reason.message}`);
    setJobSelected(new Set()); await refresh();
  };
  const runAction = (job: Job, operation: string) => { void action(job, operation).then(refresh).catch(caught => setError(caught.message)); };
  const download = (job: Job) => { if (job.download) { const a = document.createElement('a'); a.href = job.download; a.download = job.outputName || ''; document.body.append(a); a.click(); a.remove(); } };
  const saveRetention = async (next: Retention) => {
    try { await jsonRequest('/settings', next, 'PUT'); setRetention(next); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save'); }
  };
  const clear = async (kind: 'history' | 'files') => {
    try { await request('/' + kind, { method: 'DELETE' }); setJobSelected(new Set()); setPage(0); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Deletion failed'); }
  };
  const toggleSource = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const rowStart = Math.max(0, Math.floor(scroll / 64) - 3);
  const rendered = sources.slice(rowStart, rowStart + 14);
  const visibleJobs = screen === 'files' ? jobs.filter(j => j.downloadAvailable) : jobs;
  const selectedJobs = jobs.filter(j => jobSelected.has(j.id));
  const exportHistory = async () => {
    try {
      const records: Job[] = [];
      let offset = 0;
      while (true) {
        const data = await request<{ jobs: Job[]; total: number }>(`/jobs?offset=${offset}&limit=100`);
        // Download URLs expire and are not part of a metadata export.
        records.push(...data.jobs.map(({ download: _download, ...job }) => job));
        offset += data.jobs.length;
        if (offset >= data.total || !data.jobs.length) break;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'hamma-history.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Export failed'); }
  };

  return <section hidden={!visible} className="universal-workspace" aria-label="Universal file processing">
    <div className="page-heading universal-heading"><div><p className="eyebrow">HAMMA</p><h1>{screen === 'workspace' ? <>Files, simplified.</> : screen === 'history' ? 'Files & History' : 'Your downloads'}</h1><p className="page-description">{screen === 'workspace' ? 'Compress. Extract. Convert.' : screen === 'history' ? 'Find past jobs and manage what stays on this device.' : 'Download completed jobs saved on this device.'}</p></div><span className="subtle-label"><ShieldCheck size={14} /> On this device</span></div>
    {offline && <div className="processor-notice" role="status"><div><strong>Local processor unavailable</strong><p>Your files stay here. Reconnect to continue.</p><details><summary>Setup</summary><p>Run <code>npm run processor</code> from the project folder. For development, also run <code>npm run dev</code>.</p></details></div><button className="button secondary" onClick={() => void connect()}><RefreshCw size={15} /> Reconnect</button></div>}
    {error && <div className="processor-notice" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {screen === 'workspace' && <>
      <div className={`surface universal-drop ${dragging ? 'drag-active' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (busy) return; void droppedSources(event.dataTransfer, capability?.limits.files).then(add).catch(caught => setError(caught.message)); }}>
        <div className="universal-drop-icon"><FileArchive size={30} strokeWidth={1.2} /></div><h2>Add your files</h2><p>Drop files or folders</p>
        <div className="button-row"><button className="button primary" disabled={busy} onClick={() => input.current?.click()}><Plus size={16} /> Add Files</button><button className="button secondary" disabled={busy} onClick={() => folder.current?.click()}><FolderPlus size={16} /> Add Folder</button></div>
        <input type="file" multiple hidden ref={input} aria-label="Add files to queue" onChange={event => { choose(Array.from(event.target.files || [])); event.target.value = ''; }} />
        <input type="file" multiple hidden ref={folder} {...{ webkitdirectory: '' }} aria-label="Add folder to queue" onChange={event => { choose(Array.from(event.target.files || [])); event.target.value = ''; }} />
      </div>
      {sources.length > 0 && <section className="surface source-panel" aria-label="Selected files">
        <div className="source-toolbar"><label className="selection-label"><input type="checkbox" checked={selected.size === sources.length} onChange={() => setSelected(selected.size === sources.length ? new Set() : new Set(sources.map(s => s.id)))} />Select all</label><span>{selected.size.toLocaleString()} selected · {formatFileSize(chosen.reduce((sum, source) => sum + source.size, 0))}</span><button className="icon-button" disabled={busy || !selected.size} aria-label="Remove selected files" onClick={() => { const remove = chosen; setSources(sources.filter(s => !selected.has(s.id))); setSelected(new Set()); for (const source of remove) if (source.upload) void request('/uploads/' + source.upload, { method: 'DELETE' }).catch(caught => setError(caught.message)); }}><Trash2 size={16} /></button></div>
        <div className="source-scroll" onScroll={event => setScroll(event.currentTarget.scrollTop)}><div style={{ height: sources.length * 64, position: 'relative' }}>{rendered.map((source, index) => <div className="source-row" key={source.id} style={{ top: (rowStart + index) * 64 }}><input type="checkbox" aria-label={`Select ${source.name}`} checked={selected.has(source.id)} onChange={() => toggleSource(source.id)} /><File size={19} strokeWidth={1.5} /><div><strong title={source.name}>{source.name}</strong><span>{source.directory ? 'Empty folder' : formatFileSize(source.size)}</span></div><span className="file-state">Waiting</span></div>)}</div></div>
        <div className="processing-actions"><button className="button primary" disabled={busy || !selected.size || !capability || offline} onClick={() => void submit('compress')}><FileArchive size={16} /> Compress</button><button className="button secondary" disabled={busy || !selected.size || !capability || offline || chosen.some(s => s.directory)} onClick={() => void submit('extract')}><ArrowDownToLine size={16} /> Extract</button><button className="button secondary" disabled={busy || !selected.size || !capability?.conversions.length || offline || chosen.some(s => s.directory)} onClick={() => void submit('convert')}><ArrowRightLeft size={16} /> Convert</button><label className="conversion-select">To<SelectField aria-label="Conversion format" value={conversion} onChange={value => setConversion(value)}>{(capability?.conversions.length ? capability.conversions : ['wav']).map(format => <option key={format}>{format}</option>)}</SelectField></label></div>
      </section>}
      {uploadStatus && <div className="upload-status" role="status"><Loader2 size={16} className="animate-spin" /><span>{uploadStatus.name}<small>{formatFileSize(uploadStatus.offset)} / {formatFileSize(uploadStatus.size)}</small></span><progress aria-label="Upload progress" value={uploadStatus.offset} max={Math.max(1, uploadStatus.size)} /><button className="icon-button" aria-label="Pause upload" onClick={() => abort.current?.abort()}><Pause size={16} /></button></div>}
      <details className="processing-options"><summary>Options</summary><div className="options-grid"><label>Archive<SelectField value={target} onChange={value => setTarget(value)} aria-label="Archive format">{(capability?.archives || ['zip']).map(format => <option key={format}>{format}</option>)}</SelectField></label><label className="selection-label"><input type="checkbox" checked={recursive} onChange={event => setRecursive(event.target.checked)} /> Open nested archives</label></div><p>Nested originals are kept alongside their contents. MP4, MKV, and WebM preserve streams when compatible. MP3, AAC, OGG, and JPG may reduce quality.</p></details>
    </>}
    <section className="processing-history" aria-label="Processing jobs">
      <div className="section-line"><h2>{screen === 'workspace' ? 'Processing queue' : screen === 'files' ? 'Available files' : 'All operations'}</h2><div className="button-row">{screen === 'workspace' && <button className="text-button" onClick={onHistory}><History size={14} /> History</button>}<button className="text-button" onClick={() => void exportHistory()} disabled={!capability}><Download size={14} /> Export</button></div></div>
      <div className="history-tools universal-search"><label className="search-field"><Search size={16} /><input aria-label="Search processing history" placeholder="Search files" value={query} onChange={event => { setQuery(event.target.value); setPage(0); setJobSelected(new Set()); }} /></label><SelectField aria-label="Filter processing history" value={filter} onChange={value => { setFilter(value); setPage(0); setJobSelected(new Set()); }}><option value="">All statuses</option>{['queued', 'processing', 'verifying', 'completed', 'failed', 'cancelled', 'interrupted', 'paused'].map(state => <option value={state} key={state}>{label(state)}</option>)}</SelectField><SelectField aria-label="Sort processing history" value={sort} onChange={value => { setSort(value); setPage(0); setJobSelected(new Set()); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="size">Largest first</option></SelectField></div>
      {visibleJobs.length > 0 && <div className="job-bulk"><label className="selection-label"><input aria-label="Select all visible jobs" type="checkbox" checked={visibleJobs.every(j => jobSelected.has(j.id))} onChange={event => setJobSelected(event.target.checked ? new Set(visibleJobs.map(j => j.id)) : new Set())} />Select all</label><span>{visibleJobs.filter(j => j.state === 'completed').length} completed · {visibleJobs.filter(j => ['failed', 'interrupted'].includes(j.state)).length} failed · {visibleJobs.filter(activeJob).length} remaining on this page</span></div>}
      {jobSelected.size > 0 && <div className="processing-actions bulk-actions"><button className="button secondary" disabled={!selectedJobs.some(j => j.downloadAvailable)} onClick={() => selectedJobs.filter(j => j.downloadAvailable).forEach(download)}><Download size={14} /> Download</button><button className="button secondary" disabled={!selectedJobs.every(j => j.state === 'queued')} onClick={() => void bulk('pause').catch(e => setError(e.message))}><Pause size={14} /> Pause queue</button><button className="button secondary" disabled={!selectedJobs.every(j => j.state === 'paused')} onClick={() => void bulk('resume').catch(e => setError(e.message))}><Play size={14} /> Resume</button><button className="button secondary" disabled={!selectedJobs.every(activeJob)} onClick={() => void bulk('cancel').catch(e => setError(e.message))}><X size={14} /> Cancel</button><button className="button secondary" disabled={!selectedJobs.every(j => ['failed', 'interrupted', 'cancelled'].includes(j.state))} onClick={() => void bulk('retry').catch(e => setError(e.message))}><RefreshCw size={14} /> Retry</button><button className="button secondary" disabled={!selectedJobs.every(terminal)} onClick={() => void bulk('', 'DELETE').catch(e => setError(e.message))}><Trash2 size={14} /> Delete history</button><button className="button secondary" disabled={!selectedJobs.every(terminal)} onClick={() => void bulk('files', 'DELETE').catch(e => setError(e.message))}><Trash2 size={14} /> Delete files</button></div>}
      <div className="surface job-list">{visibleJobs.length ? visibleJobs.map(job => <article className="processing-job" key={job.id}>
        <div className="processing-job-line"><input type="checkbox" aria-label={`Select job ${job.name}`} checked={jobSelected.has(job.id)} onChange={() => setJobSelected(previous => { const next = new Set(previous); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next; })} /><span className={`job-glyph ${job.state === 'completed' ? 'done' : ''}`}>{job.state === 'completed' ? <Check size={18} /> : activeJob(job) && job.state !== 'queued' && job.state !== 'paused' ? <Loader2 size={18} className="animate-spin" /> : <FileArchive size={18} />}</span><div className="processing-job-name"><strong title={job.name}>{job.outputName || job.name}</strong><span>{job.operation} · {formatFileSize(job.inputSize)}{job.outputSize !== null ? ` → ${formatFileSize(job.outputSize)}` : ''}{job.operation === 'compress' && job.outputSize !== null && job.inputSize > 0 ? ` · ${savings(job)}` : ''}</span></div><span className="file-state" role="status">{label(job.state)}</span>{job.downloadAvailable && <button className="icon-button" aria-label={`Download ${job.outputName}`} onClick={() => download(job)}><Download size={17} /></button>}{activeJob(job) && <button className="icon-button" aria-label={`Cancel ${job.name}`} onClick={() => runAction(job, 'cancel')}><X size={16} /></button>}{['failed', 'interrupted', 'cancelled'].includes(job.state) && <button className="icon-button" aria-label={`Retry ${job.name}`} onClick={() => runAction(job, 'retry')}><RefreshCw size={16} /></button>}</div>
        {activeJob(job) && <div className="job-measurement">{job.operation === 'compress' && job.state === 'processing' ? <><progress aria-label={`Progress for ${job.name}`} max={Math.max(1, job.inputSize)} value={Math.min(job.inputSize, job.processed)} /><span>{formatFileSize(job.processed)} / {formatFileSize(job.inputSize)}</span></> : <span>{job.state === 'verifying' ? 'Checking output' : job.expanded ? `${job.entries} entries · ${formatFileSize(job.expanded)} expanded` : job.mediaSeconds ? `${job.mediaSeconds.toFixed(1)}s converted · track ${job.track}/${job.tracks}` : label(job.state)}</span>}</div>}
        {job.error && <p className="job-error">{job.error}</p>}
        <details className="job-details"><summary>Details</summary><dl><dt>Job</dt><dd>{job.id}</dd><dt>Input</dt><dd>{job.format} · {job.fileCount} entries</dd><dt>Created</dt><dd>{new Date(job.created * 1000).toLocaleString()}</dd><dt>Duration</dt><dd>{job.duration === undefined || job.duration === null ? '—' : `${job.duration.toFixed(2)}s`}</dd><dt>Files expire</dt><dd>{new Date(job.fileExpires * 1000).toLocaleString()}</dd><dt>History expires</dt><dd>{job.historyExpires ? new Date(job.historyExpires * 1000).toLocaleString() : 'Never'}</dd></dl></details>
      </article>) : <div className="processing-empty"><History size={22} strokeWidth={1.3} /><p>{query || filter ? 'No matching files' : screen === 'files' ? 'No downloads available' : 'No jobs yet'}</p></div>}</div>
      <div className="history-pagination"><span>{total.toLocaleString()} records</span><div><button className="icon-button" aria-label="Previous history page" disabled={!page} onClick={() => { setPage(page - 1); setJobSelected(new Set()); }}><ChevronLeft size={17} /></button><span>{page + 1} / {Math.max(1, Math.ceil(total / 50))}</span><button className="icon-button" aria-label="Next history page" disabled={(page + 1) * 50 >= total} onClick={() => { setPage(page + 1); setJobSelected(new Set()); }}><ChevronRight size={17} /></button></div></div>
    </section>
    {screen === 'history' && <details className="processing-options"><summary>Retention</summary><div className="options-grid"><label>History<SelectField aria-label="History retention" value={retention.historyRetention} onChange={value => void saveRetention({ ...retention, historyRetention: value })}>{[['24h', '24 Hours'], ['7d', '7 Days'], ['30d', '30 Days'], ['never', 'Never']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</SelectField></label><label>Files<SelectField aria-label="File retention" value={retention.fileRetention} onChange={value => void saveRetention({ ...retention, fileRetention: value })}>{[['24h', '24 Hours'], ['7d', '7 Days'], ['30d', '30 Days']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</SelectField></label></div><p>Applies to new jobs. Deleting history keeps files until their expiry. Deleting files removes inputs and outputs when no other job uses them. Downloaded copies stay on your device. This guest session keeps up to 500 records.</p><div className="button-row"><button className="button secondary" disabled={!capability || busy} onClick={() => void clear('history')}><Trash2 size={14} /> Clear history</button><button className="button secondary" disabled={!capability || busy} onClick={() => void clear('files')}><Trash2 size={14} /> Delete all files</button></div></details>}
  </section>;
}
