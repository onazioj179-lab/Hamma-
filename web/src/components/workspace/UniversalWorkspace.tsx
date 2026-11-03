import { useAppStore } from '../../store/app';
import { combineActivity, filterActivity, loadJobs, type ActivityJob } from '../../processing/activity';
import { SelectField } from '../ui/SelectField';
import { ConfirmAction, type ConfirmationRequest } from '../ui/ConfirmAction';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRightLeft, Check, ChevronLeft, ChevronRight, Download, File, FileArchive, FolderPlus, History, Loader2, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { activeJob, droppedSources, jsonRequest, request, requestId, randomId, upload, type Capability, type Job, type Retention, type Source } from '../../processing/client';
import { formatFileSize } from '../../utils/fileHelpers';
import '../../processing/processing.css';

type Props = { visible: boolean; screen: 'workspace' | 'files' | 'history'; onHistory: () => void; spkResult?: { outputName: string; downloadUrl: string | null; historyId?: string; historyCreated?: number; originalSize?: number; resultSize?: number; operation?: 'compress' | 'extract' } | null; onSpkDownload?: () => void; spkReady?: boolean; spkBusy?: boolean; spkStatus?: ReactNode; onSpkSelect?: (files: File[], restore: boolean) => Promise<boolean> };
const terminal = (job: Job) => !activeJob(job);
const label = (state: string) => ({ queued: 'Waiting', paused: 'Paused', processing: 'Processing', verifying: 'Verifying', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }[state] || state);
const savings = (job: Job) => `${(Math.abs(1 - job.outputSize! / job.inputSize) * 100).toFixed(1)}% ${job.outputSize! <= job.inputSize ? 'smaller' : 'larger'}`;

export function UniversalWorkspace({ visible, screen, onHistory, spkResult, onSpkDownload, spkReady, spkBusy, spkStatus, onSpkSelect }: Props) {
  const archives = useAppStore(state => state.recentArchives);
  const legacyHistory = useAppStore(state => state.history);
  const removeArchive = useAppStore(state => state.removeRecentArchive);
  const outputs = useAppStore(state => state.sessionOutputs);
  const deleteOutput = useAppStore(state => state.deleteSessionOutput);

  const [capability, setCapability] = useState<Capability | null>(null);
  const [offline, setOffline] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobSelected, setJobSelected] = useState(new Set<string>());
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const [operationFilter, setOperationFilter] = useState('');
  const [savingRetention, setSavingRetention] = useState(false);
  const [target, setTarget] = useState('zip');
  const [conversion, setConversion] = useState('wav');
  const [qualityMode, setQualityMode] = useState<'lossless' | 'lossy'>('lossless');
  const [metadataPolicy, setMetadataPolicy] = useState<'strip' | 'preserve'>('strip');
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [preparingDeletion, setPreparingDeletion] = useState(false);
  const [acting, setActing] = useState(false);
  const preparingDelete = useRef(false);
  const mutation = useRef(false);
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
  const activity = useRef(false);
  const knownStates = useRef(new Map<string, string>());
  const [loadingJobs, setLoadingJobs] = useState(true);

  const refreshController = useRef<AbortController | null>(null);
  const deletionPreviewController = useRef<AbortController | null>(null);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); refreshController.current?.abort(); deletionPreviewController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!visible) { deletionPreviewController.current?.abort(); if (!mutation.current) setConfirmation(null); }
  }, [visible]);

  const refresh = useCallback((force = false): Promise<void> => {
    if (refreshFlight.current && !force) return refreshFlight.current;
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    const task = (async () => {
      try {
        const records = await loadJobs(controller.signal, true);
        if (!mounted.current || controller.signal.aborted) return;
        const finished = records.filter(job => knownStates.current.has(job.id) && knownStates.current.get(job.id) !== job.state && ['completed', 'failed'].includes(job.state));
        for (const job of finished) window.dispatchEvent(new CustomEvent('hamma-job-notice', { detail: { message: `${job.outputName || job.name}: ${job.state === 'completed' ? 'Ready to download' : 'Could not finish. Open history to retry.'}` } }));
        knownStates.current = new Map(records.map(job => [job.id, job.state]));
        setLoadingJobs(false); setOffline(false); setJobs(records);
        window.dispatchEvent(new CustomEvent('hamma-job-count', { detail: records.filter(job => !job.hidden).length }));
        window.dispatchEvent(new CustomEvent('hamma-jobs-updated', { detail: records }));
        window.dispatchEvent(new CustomEvent('hamma-processor-status', { detail: 'ready' }));
        activity.current = records.some(activeJob);
      } catch (caught) {
        if (controller.signal.aborted || !mounted.current) return;
        setLoadingJobs(false); setOffline(true);
        window.dispatchEvent(new CustomEvent('hamma-processor-status', { detail: 'offline' }));
        throw caught;
      }
    })();
    refreshFlight.current = task;
    void task.finally(() => { if (refreshController.current === controller) refreshFlight.current = null; }).catch(() => {});
    return task;
  }, []);
  const connect = useCallback(async () => {
    try {
      const caps = await request<Capability>('/capabilities');
      if (caps.processing !== 'local' || caps.version !== 1) throw new Error('Unavailable');
      setCapability(caps); setOffline(false);
      setRetention(await request<Retention>('/settings'));
      await refresh(true);
    } catch { if (mounted.current) { setOffline(true); setLoadingJobs(false); window.dispatchEvent(new CustomEvent('hamma-processor-status', { detail: 'offline' })); } }
  }, [refresh]);
  useEffect(() => { void connect(); }, [connect]);
  useEffect(() => {
    const reconnect = () => { if (document.visibilityState === 'visible') void connect(); };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    return () => { window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', reconnect); };
  }, [connect, refresh]);
  useEffect(() => {
    if (!capability) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch { /* Refresh exposes the disconnected state. */ }
      if (!disposed) timer = setTimeout(poll, activity.current ? 1000 : 10000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [capability, refresh]);

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
  const choose = (files: File[]) => add(files.map(file => ({ id: randomId(), file, name: file.webkitRelativePath || file.name, size: file.size, directory: false })));
  const chosen = sources.filter(source => selected.has(source.id));
  const submit = async (operation: 'compress' | 'extract' | 'convert') => {
    if (submitting.current || spkBusy || !chosen.length) return;
    if (operation === 'convert' && ['mp3', 'aac', 'm4a', 'ogg', 'opus', 'jpg'].includes(conversion) && qualityMode !== 'lossy') {
      setError(`${conversion.toUpperCase()} can reduce quality. Choose Allow quality loss before converting.`);
      return;
    }
    const browserOnly = (operation === 'compress' && target === 'spk') || (operation === 'extract' && chosen.every(source => /\.spk$/i.test(source.name)));
    if (browserOnly) {
      if (!onSpkSelect || !spkReady || chosen.some(source => !source.file)) return;
      submitting.current = true; setBusy(true); setError('');
      const completed = new Set<string>();
      try {
        if (operation === 'compress') {
          if (await onSpkSelect(chosen.map(source => source.file!), false)) chosen.forEach(source => completed.add(source.id));
        } else {
          for (const source of chosen) { if (!await onSpkSelect([source.file!], true)) break; completed.add(source.id); }
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'SPK operation could not finish.');
      } finally {
        if (completed.size) { setPage(0); setQuery(''); setFilter(''); setSort('newest'); }
        setSources(previous => previous.filter(source => !completed.has(source.id)));
        setSelected(previous => new Set([...previous].filter(id => !completed.has(id))));
        setBusy(false); submitting.current = false;
      }
      return;
    }
    if (!capability) return;
    submitting.current = true; setBusy(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    const submitted = new Set<string>();
    try {
      const inputs: { source: Source; id: string }[] = [];
      for (const source of chosen) {
        controller.signal.throwIfAborted();
        if (operation === 'extract' && /\.spk$/i.test(source.name)) {
          if (!onSpkSelect || !spkReady || !source.file) throw new Error('SPK engine is not ready.');
          if (!await onSpkSelect([source.file], true)) throw new Error('SPK restoration did not complete.');
          submitted.add(source.id); continue;
        }
        const id = await upload(source, controller.signal, offset => { source.uploaded = offset; setUploadStatus({ name: source.name, offset, size: source.size }); });
        inputs.push({ source, id });
        if (operation !== 'compress') {
          const conversionOptions = operation === 'convert' ? { qualityMode, metadataPolicy } : {};
          await jsonRequest('/jobs', { uploads: [id], operation, target: operation === 'extract' ? 'zip' : conversion, recursive, ...conversionOptions, requestId: await requestId([source.id, operation, conversion, recursive, conversionOptions]) });
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
        void refresh(true).catch(() => {});
      }
    }
  };
  const action = async (job: Job, operation: string, method = 'POST') => {
    await request('/jobs/' + job.id + (operation ? '/' + operation : ''), { method });
  };
  const bulk = async (operation: string, method = 'POST', captured?: ActivityJob[]) => {
    if (mutation.current) return;
    mutation.current = true; setActing(true);
    setError('');
    try {
      const chosenJobs = captured || combined.filter(j => jobSelected.has(j.id));
      const results = await Promise.allSettled(chosenJobs.map(async job => {
        if (job.localId) {
          if (operation === '' && method === 'DELETE') removeLocalHistory(job.localId);
          else if (operation === 'files' && method === 'DELETE') deleteOutput(job.localId);
          else throw new Error('This action requires a processor job.');
        } else await action(job, operation, method);
      }));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length) setError(`${failed.length} action(s) failed: ${failed[0].reason instanceof Error ? failed[0].reason.message : 'The action could not finish.'}`);
      setJobSelected(new Set()); if (!offline) await refresh(true);
    } finally { mutation.current = false; setActing(false); }
  };
  const confirmBulk = (operation: '' | 'files') => {
    const captured = combined.filter(job => jobSelected.has(job.id)).map(job => ({ ...job }));
    if (!captured.length || busy || spkBusy || mutation.current || preparingDelete.current) return;
    const count = captured.length.toLocaleString();
    setConfirmation({
      title: operation === 'files' ? `Delete files for ${count} selected ${captured.length === 1 ? 'operation' : 'operations'}?` : `Delete ${count} selected history ${captured.length === 1 ? 'record' : 'records'}?`,
      description: operation === 'files'
        ? 'This removes their stored inputs and outputs. Inputs still used by another job are kept. History and downloaded copies stay. Stored-file deletion cannot be undone.'
        : 'This removes these activity records. Stored output files and downloaded copies stay available until their expiry.',
      confirmLabel: operation === 'files' ? 'Delete files' : 'Delete history',
      onConfirm: async () => { try { await bulk(operation, 'DELETE', captured); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Deletion failed'); } },
    });
  };
  const runAction = (job: Job, operation: string) => { void action(job, operation).then(() => refresh(true)).catch(caught => setError(caught.message)); };
  const download = (job: ActivityJob) => { if (job.localId && !job.download) { onSpkDownload?.(); return; } if (job.download) { const a = document.createElement('a'); a.href = job.download; a.download = job.outputName || ''; document.body.append(a); a.click(); a.remove(); } };
  const saveRetention = async (next: Retention) => {
    setSavingRetention(true);
    try { await jsonRequest('/settings', next, 'PUT'); setRetention(next); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save'); }
    finally { setSavingRetention(false); }
  };
  const removeLocalHistory = (id: string) => {
    if (id === 'current') useAppStore.getState().clearResult();
    else removeArchive(id);
  };
  const confirmClear = async (kind: 'history' | 'files') => {
    if (preparingDelete.current || mutation.current) return;
    preparingDelete.current = true; setPreparingDeletion(true); setError('');
    const controller = new AbortController(); deletionPreviewController.current = controller;
    const store = useAppStore.getState();
    const historyIds = [...new Set([...store.recentArchives.map(entry => entry.id), ...Object.entries(store.sessionOutputs).filter(([, output]) => !output.hidden).map(([id]) => id)])];
    const legacyIds = (Array.isArray(store.history) ? store.history : []).map(entry => entry.id);
    const fileIds = Object.entries(store.sessionOutputs).filter(([, output]) => output.downloadUrl).map(([id]) => id);
    const useProcessor = !!capability && !offline;
    try {
      const preview = useProcessor ? await request<{ historyRecords: number; inputFiles: number; outputFiles: number; activeJobs: number; historyToken: string; filesToken: string }>('/deletion-preview', { signal: controller.signal }) : null;
      if (!mounted.current || controller.signal.aborted) return;
      if (preview && (!(['historyRecords', 'inputFiles', 'outputFiles', 'activeJobs'] as const).every(key => Number.isSafeInteger(preview[key]) && preview[key] >= 0) || typeof preview.historyToken !== 'string' || !preview.historyToken || typeof preview.filesToken !== 'string' || !preview.filesToken)) {
        throw new Error('Could not verify the deletion selection. Reconnect and try again.');
      }
      setConfirmation({
        title: kind === 'history' ? 'Clear processing history?' : 'Delete all stored files?',
        description: kind === 'history' ? <>
          <p>{(preview?.historyRecords || 0).toLocaleString()} processor history records and {(historyIds.length + legacyIds.length).toLocaleString()} browser activity records.</p>
          <p>Stored files, downloaded copies and running jobs stay. {useProcessor ? '' : 'Processor history is not included while disconnected.'}</p>
        </> : <>
          <p>{(preview?.inputFiles || 0).toLocaleString()} uploaded {preview?.inputFiles === 1 ? 'item' : 'items'}, {(preview?.outputFiles || 0).toLocaleString()} processor {preview?.outputFiles === 1 ? 'output' : 'outputs'} and {fileIds.length.toLocaleString()} temporary browser {fileIds.length === 1 ? 'download' : 'downloads'}.</p>
          {!!preview?.activeJobs && <p>{preview.activeJobs.toLocaleString()} active or paused {preview.activeJobs === 1 ? 'job' : 'jobs'} will be cancelled.</p>}
          <p>History and downloaded copies stay. Stored-file deletion cannot be undone. {useProcessor ? '' : 'Processor files are not included while disconnected.'}</p>
        </>,
        confirmLabel: kind === 'history' ? 'Clear history' : 'Delete files',
        onConfirm: async () => {
          if (mutation.current) return;
          mutation.current = true; setActing(true);
          try {
            if (preview) await request('/' + kind, { method: 'DELETE', headers: { 'X-Hamma-Deletion-Token': kind === 'history' ? preview.historyToken : preview.filesToken } });
            if (kind === 'history') {
              historyIds.forEach(id => removeArchive(id));
              legacyIds.forEach(id => useAppStore.getState().removeHistoryEntry(id));
            } else fileIds.forEach(id => deleteOutput(id));
            setJobSelected(new Set()); setPage(0);
            if (useProcessor) await refresh(true);
            else if (jobs.length) setError('Browser data cleared. Reconnect to clear processor data as well.');
          } catch (caught) { setError(caught instanceof Error ? caught.message : 'Deletion failed'); }
          finally { mutation.current = false; setActing(false); }
        },
      });
    } catch (caught) { if (!controller.signal.aborted && mounted.current) setError(caught instanceof Error ? caught.message : 'Deletion preview failed'); }
    finally { preparingDelete.current = false; if (mounted.current) setPreparingDeletion(false); }
  };
  const confirmLocalHistory = (id: string) => {
    if (preparingDelete.current || mutation.current) return;
    setConfirmation({
      title: 'Remove 1 history record?',
      description: 'This removes the activity record. Stored downloads and copies on your device stay.',
      confirmLabel: 'Remove record', onConfirm: () => removeLocalHistory(id),
    });
  };
  const removeSelectedSources = () => {
    const captured = chosen.map(source => ({ ...source }));
    const uploaded = captured.filter(source => source.upload);
    const remove = async () => {
      const outcomes = await Promise.allSettled(uploaded.map(source => request('/uploads/' + source.upload, { method: 'DELETE' })));
      const removed = new Set(captured.filter(source => !source.upload).map(source => source.id));
      outcomes.forEach((outcome, index) => { if (outcome.status === 'fulfilled') removed.add(uploaded[index].id); });
      setSources(previous => previous.filter(source => !removed.has(source.id)));
      setSelected(previous => new Set([...previous].filter(id => !removed.has(id))));
      const failed = outcomes.filter(outcome => outcome.status === 'rejected').length;
      if (failed) setError(`${failed} uploaded ${failed === 1 ? 'item' : 'items'} could not be deleted. They remain selected so you can retry.`);
    };
    if (!uploaded.length) { void remove(); return; }
    setConfirmation({
      title: `Remove ${captured.length.toLocaleString()} selected ${captured.length === 1 ? 'item' : 'items'}?`,
      description: `${uploaded.length.toLocaleString()} uploaded ${uploaded.length === 1 ? 'item' : 'items'} will be deleted from the processor. Original files on your device stay.`,
      confirmLabel: 'Remove selected', onConfirm: remove,
    });
  };
  const toggleSource = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const rowStart = Math.min(Math.max(0, sources.length - 14), Math.max(0, Math.floor(scroll / 64) - 3));
  const rendered = sources.slice(rowStart, rowStart + 14);
  const downloadsOnly = screen === 'files' || operationFilter === 'downloads';
  const combined = combineActivity(jobs, archives, outputs, downloadsOnly);
  let latestLocal = spkResult?.historyId ? combined.find(job => job.localId === spkResult.historyId) : undefined;
  if (!latestLocal && spkResult?.downloadUrl && !(spkResult.historyId && outputs[spkResult.historyId])) {
    latestLocal = { id: 'spk:current', localId: 'current', name: spkResult.outputName,
      operation: spkResult.operation || 'compress', target: 'spk', format: 'spk', state: 'completed',
      inputSize: spkResult.originalSize || 0, outputSize: spkResult.resultSize ?? null,
      processed: 0, created: (spkResult.historyCreated || Date.now()) / 1000,
      entries: 1, fileCount: 1, downloadAvailable: true, fileExpires: 0, historyExpires: null };
    combined.push(latestLocal);
  }
  if (latestLocal && spkResult?.downloadUrl) {
    latestLocal.downloadAvailable = true; latestLocal.outputName = spkResult.outputName; latestLocal.download = spkResult.downloadUrl;
  }
  const matching = filterActivity(combined.filter(job => downloadsOnly ? job.downloadAvailable : !operationFilter || job.operation === operationFilter), query, filter, sort);
  const total = matching.length;
  const lastPage = Math.max(0, Math.ceil(total / 50) - 1);
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  const visibleJobs = matching.slice(page * 50, (page + 1) * 50);
  const selectedJobs = combined.filter(j => jobSelected.has(j.id));
  const selectedIds = new Set(combined.map(job => job.id));
  useEffect(() => {
    setJobSelected(previous => [...previous].some(id => !selectedIds.has(id)) ? new Set([...previous].filter(id => selectedIds.has(id))) : previous);
  }, [jobs, archives, outputs, downloadsOnly]);
  const exportHistory = async () => {
    try {
      const records = combineActivity(offline ? jobs : await loadJobs(), archives, outputs).map(({ download: _download, ...job }) => job);
      const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'hamma-history.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Export failed'); }
  };

  return <section hidden={!visible} className="universal-workspace" aria-label="Universal file processing">
    <div className="page-heading universal-heading"><div><p className="eyebrow">HAMMA</p><h1>{screen === 'workspace' ? <>Files, simplified.</> : screen === 'history' ? 'Files & History' : 'Your downloads'}</h1><p className="page-description">{screen === 'workspace' ? 'Compress. Extract. Convert.' : screen === 'history' ? 'Every operation, in one place. Search by file, type, or unique ID.' : 'Download completed jobs saved on this device.'}</p></div><span className="subtle-label"><ShieldCheck size={14} /> {location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'On this device' : 'Private server'}</span></div>
    {offline && <div className="processor-notice" role="status"><div><strong>Local processor unavailable</strong><p>Reconnect to check saved jobs.</p></div><button className="button secondary" onClick={() => void connect()}><RefreshCw size={15} /> Reconnect</button></div>}
    {preparingDeletion && <p role="status" className="footnote">Checking stored items…</p>}
    {error && <div className="processor-notice" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {screen === 'workspace' && <>
      <div className={`surface universal-drop ${dragging ? 'drag-active' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (busy || spkBusy) return; void droppedSources(event.dataTransfer, capability?.limits.files).then(add).catch(caught => setError(caught.message)); }}>
        <div className="universal-drop-icon"><FileArchive size={30} strokeWidth={1.2} /></div><h2>Add your files</h2><p>Drop files or folders</p>
        <div className="button-row"><button className="button primary" disabled={busy || spkBusy} onClick={() => input.current?.click()}><Plus size={16} /> Add Files</button><button className="button secondary" disabled={busy || spkBusy} onClick={() => folder.current?.click()}><FolderPlus size={16} /> Add Folder</button></div>
        <input type="file" multiple hidden ref={input} aria-label="Add files to queue" onChange={event => { choose(Array.from(event.target.files || [])); event.target.value = ''; }} />
        <input type="file" multiple hidden ref={folder} {...{ webkitdirectory: '' }} aria-label="Add folder to queue" onChange={event => { choose(Array.from(event.target.files || [])); event.target.value = ''; }} />
      </div>
      {sources.length > 0 && <section className="surface source-panel" aria-label="Selected files">
        <div className="source-toolbar"><label className="selection-label"><input type="checkbox" checked={selected.size === sources.length} onChange={() => setSelected(selected.size === sources.length ? new Set() : new Set(sources.map(s => s.id)))} />Select all</label><span>{selected.size.toLocaleString()} selected · {formatFileSize(chosen.reduce((sum, source) => sum + source.size, 0))}</span><button className="icon-button" disabled={busy || spkBusy || !selected.size} aria-label="Remove selected files" onClick={removeSelectedSources}><Trash2 size={16} /></button></div>
        <div className="source-scroll" onScroll={event => setScroll(event.currentTarget.scrollTop)}><div style={{ height: sources.length * 64, position: 'relative' }}>{rendered.map((source, index) => <div className="source-row" key={source.id} style={{ top: (rowStart + index) * 64 }}><input type="checkbox" aria-label={`Select ${source.name}`} checked={selected.has(source.id)} onChange={() => toggleSource(source.id)} /><File size={19} strokeWidth={1.5} /><div><strong title={source.name}>{source.name}</strong><span>{source.directory ? 'Empty folder' : formatFileSize(source.size)}</span></div><span className="file-state">Waiting</span></div>)}</div></div>
        <div className="processing-actions"><button className="button primary" disabled={busy || spkBusy || !selected.size || (target === 'spk' ? !spkReady || chosen.some(source => source.directory) : !capability || offline)} onClick={() => void submit('compress')}><FileArchive size={16} /> Compress</button><button className="button secondary" disabled={busy || spkBusy || !selected.size || chosen.some(s => s.directory) || (chosen.every(source => /\.spk$/i.test(source.name)) ? !spkReady : !capability || offline)} onClick={() => void submit('extract')}><ArrowDownToLine size={16} /> Extract</button><button className="button secondary" disabled={busy || spkBusy || !selected.size || !capability?.conversions.length || offline || chosen.some(s => s.directory)} onClick={() => void submit('convert')}><ArrowRightLeft size={16} /> Convert</button><label className="conversion-select">To<SelectField disabled={busy || spkBusy} aria-label="Conversion format" value={conversion} onChange={value => setConversion(value)}>{(capability?.conversions.length ? capability.conversions : ['wav']).map(format => <option key={format}>{format}</option>)}</SelectField></label><label className="conversion-select">Quality<SelectField disabled={busy || spkBusy} aria-label="Conversion quality" value={qualityMode} onChange={value => setQualityMode(value as "lossless" | "lossy")}><option value="lossless">Lossless</option><option value="lossy">Allow quality loss</option></SelectField></label></div>
      </section>}
      {capability && !capability.conversions.length && <p className="footnote">Media conversion is unavailable until FFmpeg and FFprobe are installed on the computer running HAMMA.</p>}
      {uploadStatus && <div className="upload-status" role="status"><Loader2 size={16} className="animate-spin" /><span>{uploadStatus.name}<small>{formatFileSize(uploadStatus.offset)} / {formatFileSize(uploadStatus.size)}</small></span><progress aria-label="Upload progress" value={uploadStatus.offset} max={Math.max(1, uploadStatus.size)} /><button className="icon-button" aria-label="Pause upload" onClick={() => abort.current?.abort()}><Pause size={16} /></button></div>}
      <details className="processing-options"><summary>Options</summary><div className="options-grid"><label>Archive<SelectField disabled={busy || spkBusy} value={target} onChange={value => setTarget(value)} aria-label="Archive format">{[...(capability?.archives || ['zip']), ...(onSpkSelect ? ['spk'] : [])].map(format => <option key={format}>{format}</option>)}</SelectField></label><label>Conversion metadata<SelectField disabled={busy || spkBusy} aria-label="Conversion metadata" value={metadataPolicy} onChange={value => setMetadataPolicy(value as "strip" | "preserve")}><option value="strip">Remove metadata</option><option value="preserve">Preserve supported tags</option></SelectField></label><label className="selection-label"><input type="checkbox" disabled={busy || spkBusy} checked={recursive} onChange={event => setRecursive(event.target.checked)} /> Open nested archives</label></div><p>Nested originals are kept alongside their contents. MP4, MKV, and WebM preserve streams when compatible. Lossy conversion requires Allow quality loss. Metadata is removed by default; preservation depends on the output format.</p></details>
    </>}
    {screen === 'workspace' && spkStatus}
    <section className="processing-history" aria-label="Processing jobs">
      <div className="section-line"><h2>{screen === 'workspace' ? 'Processing queue' : screen === 'files' ? 'Available files' : 'All operations'}</h2><div className="button-row">{screen === 'workspace' && <button className="text-button" onClick={onHistory}><History size={14} /> History</button>}<button className="text-button" onClick={() => void exportHistory()} disabled={!combined.length}><Download size={14} /> Export</button></div></div>
      <div className="history-tools universal-search"><label className="search-field"><Search size={16} /><input aria-label="Search processing history" placeholder="Search files" value={query} onChange={event => { setQuery(event.target.value); setPage(0); setJobSelected(new Set()); }} /></label><SelectField aria-label="Filter processing history" value={filter} onChange={value => { setFilter(value); setPage(0); setJobSelected(new Set()); }}><option value="">All statuses</option>{['queued', 'processing', 'verifying', 'completed', 'failed', 'cancelled', 'interrupted', 'paused'].map(state => <option value={state} key={state}>{label(state)}</option>)}</SelectField><SelectField aria-label="Filter by operation" value={operationFilter} onChange={value => { setOperationFilter(value); setPage(0); setJobSelected(new Set()); }}><option value="">All operations</option><option value="compress">Compression</option><option value="extract">Extraction</option><option value="convert">Conversion</option><option value="downloads">Available downloads</option></SelectField><SelectField aria-label="Sort processing history" value={sort} onChange={value => { setSort(value); setPage(0); setJobSelected(new Set()); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="size">Largest first</option></SelectField></div>
      {visibleJobs.length > 0 && <div className="job-bulk"><label className="selection-label"><input aria-label="Select all visible jobs" type="checkbox" checked={visibleJobs.every(j => jobSelected.has(j.id))} onChange={event => setJobSelected(event.target.checked ? new Set(visibleJobs.map(j => j.id)) : new Set())} />Select all</label><span>{visibleJobs.filter(j => j.state === 'completed').length} completed · {visibleJobs.filter(j => ['failed', 'interrupted'].includes(j.state)).length} failed · {visibleJobs.filter(activeJob).length} remaining on this page</span></div>}
      {jobSelected.size > 0 && <div className="processing-actions bulk-actions"><button className="button secondary" disabled={!selectedJobs.some(j => j.downloadAvailable)} onClick={() => selectedJobs.filter(j => j.downloadAvailable).forEach(download)}><Download size={14} /> Download</button><button className="button secondary" disabled={!selectedJobs.every(j => j.state === 'queued')} onClick={() => void bulk('pause').catch(e => setError(e.message))}><Pause size={14} /> Pause queue</button><button className="button secondary" disabled={!selectedJobs.every(j => j.state === 'paused')} onClick={() => void bulk('resume').catch(e => setError(e.message))}><Play size={14} /> Resume</button><button className="button secondary" disabled={!selectedJobs.every(activeJob)} onClick={() => void bulk('cancel').catch(e => setError(e.message))}><X size={14} /> Cancel</button><button className="button secondary" disabled={!selectedJobs.every(j => ['failed', 'interrupted', 'cancelled'].includes(j.state))} onClick={() => void bulk('retry').catch(e => setError(e.message))}><RefreshCw size={14} /> Retry</button><button className="button secondary" disabled={busy || spkBusy || acting || preparingDeletion || !selectedJobs.every(terminal)} onClick={() => confirmBulk('')}><Trash2 size={14} /> Delete history</button><button className="button secondary" disabled={busy || spkBusy || acting || preparingDeletion || !selectedJobs.length || !selectedJobs.every(job => terminal(job) && (!job.localId || job.downloadAvailable))} onClick={() => confirmBulk('files')}><Trash2 size={14} /> Delete files</button></div>}
      <div className="surface job-list" aria-busy={loadingJobs && !offline}>{loadingJobs && !offline && <p className="queue-loading" role="status"><Loader2 size={16} className="animate-spin" /> Loading your jobs</p>}{visibleJobs.length ? visibleJobs.map(job => <article className="processing-job" key={job.id}>
        <div className="processing-job-line"><input type="checkbox" aria-label={`Select job ${job.name}`} checked={jobSelected.has(job.id)} onChange={() => setJobSelected(previous => { const next = new Set(previous); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next; })} /><span className={`job-glyph ${job.state === 'completed' ? 'done' : ''}`}>{job.state === 'completed' ? <Check size={18} /> : activeJob(job) && job.state !== 'queued' && job.state !== 'paused' ? <Loader2 size={18} className="animate-spin" /> : <FileArchive size={18} />}</span><div className="processing-job-name"><strong title={job.name}>{job.outputName || job.name}</strong><span><b className={`operation-tag tag-${job.operation}`}>{job.localId ? 'SPK' : (job.target || job.format || 'file').toUpperCase()} / {job.operation}</b> · {formatFileSize(job.inputSize)}{job.outputSize !== null ? ` → ${formatFileSize(job.outputSize)}` : ''}{job.operation === 'compress' && job.outputSize !== null && job.inputSize > 0 ? ` · ${savings(job)}` : ''}</span></div><span className={`file-state state-${job.state}`} role="status">{label(job.state)}</span>{job.downloadAvailable && (job.localId ? <a className="icon-button" href={job.download} download={job.outputName} aria-label={`Download ${job.outputName}`} title="Download"><Download size={17} /><span className="sr-only">Download</span></a> : <button className="icon-button" aria-label={`Download ${job.outputName}`} title="Download" onClick={() => download(job)}><Download size={17} /><span className="sr-only">Download</span></button>)}{activeJob(job) && <button className="icon-button" aria-label={`Cancel ${job.name}`} onClick={() => runAction(job, 'cancel')}><X size={16} /></button>}{['failed', 'interrupted', 'cancelled'].includes(job.state) && <button className="icon-button" aria-label={`Retry ${job.name}`} onClick={() => runAction(job, 'retry')}><RefreshCw size={16} /></button>}</div>
        {activeJob(job) && <div className="job-measurement">{job.operation === 'compress' && job.state === 'processing' ? <><progress aria-label={`Progress for ${job.name}`} max={Math.max(1, job.inputSize)} value={Math.min(job.inputSize, job.processed)} /><span>{formatFileSize(job.processed)} / {formatFileSize(job.inputSize)}</span></> : <span>{job.state === 'verifying' ? 'Checking output' : job.expanded ? `${job.entries} entries · ${formatFileSize(job.expanded)} expanded` : job.mediaSeconds ? `${job.mediaSeconds.toFixed(1)}s converted · track ${job.track}/${job.tracks}` : label(job.state)}</span>}</div>}
        {job.error && <p className="job-error">{job.error}</p>}
        <details className="job-details"><summary>Details</summary><dl><dt>Job</dt><dd>{job.id}</dd><dt>Input</dt><dd>{job.format} · {job.fileCount} entries</dd><dt>Created</dt><dd>{new Date(job.created * 1000).toLocaleString()}</dd><dt>Finished</dt><dd>{job.finished != null ? new Date(job.finished * 1000).toLocaleString() : job.localId ? new Date(job.created * 1000).toLocaleString() : "—"}</dd><dt>Duration</dt><dd>{job.duration === undefined || job.duration === null ? '—' : `${job.duration.toFixed(2)}s`}</dd><dt>Files expire</dt><dd>{job.localId ? job.savedToDevice ? 'Saved directly to your device' : job.downloadAvailable ? 'Available until this page closes or you delete it' : 'Not retained in this browser' : new Date(job.fileExpires * 1000).toLocaleString()}</dd><dt>History expires</dt><dd>{job.historyExpires ? new Date(job.historyExpires * 1000).toLocaleString() : 'Never'}</dd></dl>{job.localId && job.localId !== 'current' && <button className="text-button" onClick={() => confirmLocalHistory(job.localId!)}><Trash2 size={14} /> Remove record</button>}</details>
      </article>) : (!loadingJobs || offline) && <div className="processing-empty"><History size={22} strokeWidth={1.3} /><p>{query || filter || operationFilter ? 'No matching files' : screen === 'files' ? 'No downloads available' : 'No jobs yet'}</p></div>}</div>
      <div className="history-pagination"><span>{total.toLocaleString()} operations</span><div><button className="icon-button" aria-label="Previous history page" disabled={!page} onClick={() => { setPage(page - 1); setJobSelected(new Set()); }}><ChevronLeft size={17} /></button><span>{page + 1} / {Math.max(1, Math.ceil(total / 50))}</span><button className="icon-button" aria-label="Next history page" disabled={(page + 1) * 50 >= total} onClick={() => { setPage(page + 1); setJobSelected(new Set()); }}><ChevronRight size={17} /></button></div></div>
    </section>
    {screen === 'history' && <details className="processing-options"><summary>Retention</summary><div className="options-grid"><label>History<SelectField disabled={savingRetention || offline} aria-label="History retention" value={retention.historyRetention} onChange={value => void saveRetention({ ...retention, historyRetention: value })}>{[['24h', '24 Hours'], ['7d', '7 Days'], ['30d', '30 Days'], ['never', 'Never']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</SelectField></label><label>Files<SelectField disabled={savingRetention || offline} aria-label="File retention" value={retention.fileRetention} onChange={value => void saveRetention({ ...retention, fileRetention: value })}>{[['24h', '24 Hours'], ['7d', '7 Days'], ['30d', '30 Days']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</SelectField></label></div><p>Applies to new jobs. Deleting history keeps files until their expiry. Deleting files removes inputs and outputs when no other job uses them. Downloaded copies stay on your device. Processor history keeps up to 500 records. Browser SPK outputs stay available until you close this page or delete them.</p><div className="button-row"><button className="button secondary" disabled={busy || spkBusy || acting || preparingDeletion || ((!capability || offline) && !archives.length && !legacyHistory.length && !Object.keys(outputs).length)} onClick={() => void confirmClear('history')}><Trash2 size={14} /> Clear history</button><button className="button secondary" disabled={busy || spkBusy || acting || preparingDeletion || ((!capability || offline) && !Object.values(outputs).some(output => output.downloadUrl))} onClick={() => void confirmClear('files')}><Trash2 size={14} /> Delete all files</button></div></details>}
    {confirmation && <ConfirmAction {...confirmation} onCancel={() => setConfirmation(null)} />}
  </section>;
}
