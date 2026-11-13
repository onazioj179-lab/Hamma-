import { inspectSources } from '../../processing/inspection';
import { allocateSourcePaths } from '../../processing/selection';
import { ErrorCenter } from './ErrorCenter';
import { ZipInspection } from './ZipInspection';
import { VerifiedFiles } from './VerifiedFiles';
import { ProjectRecovery, defaultProjectSettings, readSelection, saveSelection } from '../../processing/projects';
import { requiresLossyConsent, resolveActions, resolveArchiveTargets } from '../../processing/actions';
import { summarizePlan, type ExecutionPlan, type TaskGroup } from '../../processing/planner';
import { executeWorkflow } from '../../processing/workflow';
import { GroupedWorkflow } from './GroupedWorkflow';
import { useAppStore } from '../../store/app';
import { combineActivity, filterActivity, loadJobs, type ActivityJob } from '../../processing/activity';
import { SelectField } from '../ui/SelectField';
import { ConfirmAction, type ConfirmationRequest } from '../ui/ConfirmAction';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRightLeft, Check, ChevronLeft, ChevronRight, Download, File, FileArchive, FolderPlus, History, Loader2, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { activeJob, droppedSources, jsonRequest, stageJobSelection, ProcessorError, request, requestId, randomId, upload, type Capability, type Job, type Retention, type Source } from '../../processing/client';
import { formatFileSize } from '../../utils/fileHelpers';
import { accountChanging } from '../../processing/account';
import { directoryPicker, readFolder } from '../../processing/folders';
import '../../processing/processing.css';

type Props = { visible: boolean; screen: 'workspace' | 'files' | 'history'; onHistory: () => void; spkResult?: { outputName: string; downloadUrl: string | null; historyId?: string; historyCreated?: number; originalSize?: number; resultSize?: number; operation?: 'compress' | 'extract' } | null; onSpkDownload?: () => void; spkReady?: boolean; spkBusy?: boolean; spkStatus?: ReactNode; onSpkSelect?: (files: File[], restore: boolean) => Promise<boolean> };
const terminal = (job: Job) => !activeJob(job);
type SourceFailure = { message: string; retry?: Omit<TaskGroup, 'sources'> };

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
  const [projectId, setProjectId] = useState('default');
  const [projectIds, setProjectIds] = useState(['default']);
  const recovery = useRef(new ProjectRecovery());
  const recoveryLoaded = useRef(false);
  const currentProject = useRef('default');
  const recoveryController = useRef<AbortController | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [selectionKey, setSelectionKey] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const drafts = useRef(new Map<string, { sources: Source[]; selected: Set<string>; target: string; zipProfile: string; conversion: string; qualityMode: 'lossless' | 'lossy'; metadataPolicy: 'strip' | 'preserve'; recursive: boolean; groupActions: Record<string, string>; errors: Record<string, SourceFailure> }>());
  const [sources, setSources] = useState<Source[]>([]);
  const liveSources = useRef(sources); liveSources.current = sources;
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
  const [zipProfile, setZipProfile] = useState('balanced');
  const [zipComment, setZipComment] = useState('');
  const [conversion, setConversion] = useState('wav');
  const [qualityMode, setQualityMode] = useState<'lossless' | 'lossy'>('lossless');
  const [metadataPolicy, setMetadataPolicy] = useState<'strip' | 'preserve'>('strip');
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [preparingDeletion, setPreparingDeletion] = useState(false);
  const [acting, setActing] = useState(false);
  const preparingDelete = useRef(false);
  const mutation = useRef(false);
  const [recursive, setRecursive] = useState(false);
  const [groupActions, setGroupActions] = useState<Record<string, string>>({});
  const [retention, setRetention] = useState<Retention>({ historyRetention: '30d', fileRetention: '24h' });
  const [error, setError] = useState('');
  const [sourceErrors, setSourceErrors] = useState<Record<string, SourceFailure>>({});
  const [busy, setBusy] = useState(false);
  const [folderHelp, setFolderHelp] = useState(false);
  const [readingFolder, setReadingFolder] = useState(false);
  const folderController = useRef<AbortController | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ name: string; offset: number; size: number; checking?: boolean } | null>(null);
  const [checkingSelection, setCheckingSelection] = useState(false);
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
  const ownerGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); folderController.current?.abort(); refreshController.current?.abort(); deletionPreviewController.current?.abort(); recoveryController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!visible) { deletionPreviewController.current?.abort(); if (!mutation.current) setConfirmation(null); }
  }, [visible]);

  const refresh = useCallback((force = false): Promise<void> => {
    if (accountChanging()) return Promise.resolve();
    if (refreshFlight.current && !force) return refreshFlight.current;
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    const task = (async () => {
      try {
        const records = await loadJobs(controller.signal, true);
        if (!mounted.current || controller.signal.aborted) return;
        const finished = records.filter(job => knownStates.current.has(job.id) && knownStates.current.get(job.id) !== job.state && ['completed', 'failed'].includes(job.state));
        for (const job of finished) window.dispatchEvent(new CustomEvent('hamma-job-notice', { detail: { success: job.state === 'completed', message: `${job.outputName || job.name}: ${job.state === 'completed' ? 'Ready to download' : 'Could not finish. Open history to retry.'}` } }));
        knownStates.current = new Map(records.map(job => [job.id, job.state]));
        setLoadingJobs(false); setOffline(false); setJobs(records);
        setProjectIds(previous => [...new Set([...previous, ...records.map(job => job.projectId || 'default')])]);
        window.dispatchEvent(new CustomEvent('hamma-job-count', { detail: records.filter(job => !job.hidden).length }));
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
  const restoreProject = useCallback(async (id: string, scope?: string) => {
    const saved = recovery.current.get(id);
    if (!saved && !scope) return;
    recoveryController.current?.abort();
    const controller = new AbortController(); recoveryController.current = controller;
    const generation = ownerGeneration.current;
    setRecovering(true);
    const settings = saved?.settings ?? defaultProjectSettings;
    setZipProfile(settings.zipProfile ?? 'balanced');
    setTarget(settings.target); setConversion(settings.conversion); setQualityMode(settings.qualityMode);
    setMetadataPolicy(settings.metadataPolicy); setRecursive(settings.recursive);
    setGroupActions(settings.groupActions || {});
    try {
      const result = saved ? await recovery.current.sources(id, controller.signal) : { sources: [], unavailable: 0 };
      if (!mounted.current || controller.signal.aborted || generation !== ownerGeneration.current || currentProject.current !== id) return;
      const key = scope ? `hamma-selection:${scope}:${id}` : '';
      const draft = key ? readSelection(key) : { sources: [], selected: [] };
      const uploadedIds = new Set(result.sources.map(source => source.id));
      setSources(previous => {
        const existing = new Set(previous.map(source => source.id));
        const savedSources = new Map(result.sources.map(source => [source.id, source]));
        const retained = previous.map(source => savedSources.has(source.id) ? { ...savedSources.get(source.id)!, file: source.file } : source);
        const restored = result.sources.filter(source => !existing.has(source.id));
        const current = [...allocateSourcePaths(restored, retained), ...restored];
        const pending = draft.sources.filter(source => !existing.has(source.id) && !uploadedIds.has(source.id));
        return [...current, ...allocateSourcePaths(current, pending)];
      });
      setSelected(previous => new Set([...previous, ...draft.selected, ...uploadedIds]));
      setSelectionKey(key);
      const incomplete = result.sources.filter(source => source.resume).length;
      const complete = result.sources.length - incomplete;
      setRecoveryNotice([
        complete ? `Recovered ${complete} uploaded ${complete === 1 ? 'file' : 'files'}.` : '',
        result.unavailable ? `Add the original files again for ${result.unavailable} expired or unavailable uploads.` : '',
      ].filter(Boolean).join(' '));
    } catch (caught) {
      if (!controller.signal.aborted && generation === ownerGeneration.current) throw caught;
    } finally {
      if (recoveryController.current === controller && mounted.current) setRecovering(false);
    }
  }, []);
  const connect = useCallback(async () => {
    if (accountChanging()) return;
    const generation = ownerGeneration.current;
    try {
      const caps = await request<Capability>('/capabilities');
      if (generation !== ownerGeneration.current || accountChanging()) return;
      if (caps.processing !== 'local' || caps.version !== 1) throw new Error('Unavailable');
      setCapability(caps); setOffline(false);
      const settings = await request<Retention>('/settings');
      if (generation !== ownerGeneration.current || accountChanging()) return;
      setRetention(settings);
      if (caps.projectRecovery && !recoveryLoaded.current) {
        recoveryLoaded.current = true; setRecovering(true);
        try {
          const projects = await recovery.current.list();
          if (generation !== ownerGeneration.current || accountChanging() || !mounted.current) return;
          setProjectIds(previous => [...new Set([...previous, ...projects.map(project => project.id)])]);
          await restoreProject(currentProject.current, caps.draftScope);
          if (generation === ownerGeneration.current && mounted.current) setRecoveryReady(true);
        } catch (caught) {
          if (generation === ownerGeneration.current) recoveryLoaded.current = false;
          throw caught;
        } finally { if (generation === ownerGeneration.current && mounted.current) setRecovering(false); }
      }
      await refresh(true);
    } catch { if (mounted.current && generation === ownerGeneration.current && !accountChanging()) { setOffline(true); setLoadingJobs(false); window.dispatchEvent(new CustomEvent('hamma-processor-status', { detail: 'offline' })); } }
  }, [refresh, restoreProject]);
  useEffect(() => {
    if (selectionKey && !recovering && !accountChanging()) saveSelection(selectionKey, sources, selected);
  }, [selectionKey, recovering, sources, selected]);
  useEffect(() => {
    if (!capability?.projectRecovery || !recoveryReady || recovering || busy || accountChanging()) return;
    const controller = new AbortController();
    const generation = ownerGeneration.current;
    const timer = setTimeout(() => {
      if (generation !== ownerGeneration.current || accountChanging() || !mounted.current) return;
      void recovery.current.save(projectId, { target, conversion, qualityMode, metadataPolicy, recursive, ...(capability.projectZipProfiles ? { zipProfile } : {}), ...(capability.groupedWorkflows ? { groupActions } : {}) }, controller.signal)
        .catch(caught => { if (!controller.signal.aborted && generation === ownerGeneration.current && mounted.current) setError(caught instanceof Error ? caught.message : 'Project settings could not be saved.'); });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [capability, recoveryReady, recovering, busy, projectId, target, conversion, qualityMode, metadataPolicy, recursive, groupActions, zipProfile]);
  useEffect(() => {
    const guard = (event: Event) => { if (busy || recovering || spkBusy || submitting.current || mutation.current || preparingDelete.current || savingRetention) event.preventDefault(); };
    const clear = () => {
      ownerGeneration.current += 1;
      recoveryController.current?.abort(); recoveryController.current = null; recovery.current = new ProjectRecovery(); recoveryLoaded.current = false;
      setRecoveryReady(false); setRecovering(false); setRecoveryNotice('');
      setSelectionKey('');
      const transferable = liveSources.current.filter(source => source.file || source.directory);
      const transferableIds = new Set(transferable.map(source => source.id));
      setSources(transferable); setSelected(previous => new Set([...previous].filter(id => transferableIds.has(id))));
      drafts.current.clear(); setProjectIds(['default']); setProjectId('default'); currentProject.current = 'default';
      setSourceErrors({}); setTarget('zip'); setZipProfile('balanced'); setZipComment(''); setConversion('wav'); setQualityMode('lossless'); setMetadataPolicy('strip'); setRecursive(false);
      setGroupActions({});
      abort.current?.abort(); folderController.current?.abort(); setFolderHelp(false);
      refreshController.current?.abort(); refreshFlight.current = null;
      deletionPreviewController.current?.abort();
      knownStates.current.clear(); activity.current = false;
      setJobs([]); setJobSelected(new Set()); setConfirmation(null); setCapability(null); setLoadingJobs(true); setError('');
      setUploadStatus(null);
      window.dispatchEvent(new CustomEvent('hamma-job-count', { detail: 0 }));
    };
    const changed = () => {
      setSources(previous => previous.map(source => ({ ...source, upload: undefined, uploaded: undefined, resume: undefined })));
      for (const draft of drafts.current.values()) draft.sources = draft.sources.map(source => ({ ...source, upload: undefined, uploaded: undefined, resume: undefined }));
      void connect();
    };
    window.addEventListener('hamma-owner-changing', guard);
    window.addEventListener('hamma-owner-clearing', clear);
    window.addEventListener('hamma-owner-changed', changed);
    return () => { window.removeEventListener('hamma-owner-changing', guard); window.removeEventListener('hamma-owner-clearing', clear); window.removeEventListener('hamma-owner-changed', changed); };
  }, [busy, recovering, spkBusy, savingRetention, connect]);
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
    if (sources.length + incoming.length > (capability?.limits.files || 5000)) { setError('File limit reached (' + (capability?.limits.files || 5000).toLocaleString() + '). Remove some files and try again.'); return; }
    for (const source of incoming) {
      if (capability && source.size > capability.limits.input) { setError(source.name + ' exceeds the ' + formatFileSize(capability.limits.input) + ' upload limit. Choose a smaller file.'); return; }
    }
    setError(''); setSources(previous => [...previous, ...allocateSourcePaths(previous, incoming)]);
    setSelected(previous => new Set([...previous, ...incoming.map(s => s.id)]));
  };
  const choose = (files: File[]) => add(files.map(file => ({ id: randomId(), file, name: file.webkitRelativePath || file.name, size: file.size, directory: false })));
  const reselect = (source: Source, file: File) => {
    if (busy || recovering || spkBusy || accountChanging()) return;
    if (file.size !== source.size || file.name.normalize('NFC') !== source.name.split('/').pop()?.normalize('NFC')) {
      setError(`Select the original file for ${source.name} with the same name and size.`);
      return;
    }
    setError('');
    setSourceErrors(previous => { const next = { ...previous }; delete next[source.id]; return next; });
    setSources(previous => previous.map(entry => entry.id === source.id ? { ...entry, file, inspection: undefined } : entry));
    setSelected(previous => new Set([...previous, source.id]));
  };
  const chooseFolder = async () => {
    if (busy || recovering || spkBusy || folderController.current || accountChanging()) return;
    setError(''); setFolderHelp(true);
    const picker = directoryPicker();
    if (!picker) {
      if (folder.current && 'webkitdirectory' in folder.current) folder.current.click();
      return;
    }
    const controller = new AbortController(); folderController.current = controller;
    const generation = ownerGeneration.current;
    setBusy(true); setReadingFolder(true);
    try {
      // Call directly from the button gesture, before awaiting any other work.
      const handle = await picker({ mode: 'read', id: 'hamma-add-folder' });
      const incoming = await readFolder(handle, capability?.limits.files || 5000, controller.signal);
      if (mounted.current && generation === ownerGeneration.current && !controller.signal.aborted) {
        add(incoming); setFolderHelp(false);
      }
    } catch (caught) {
      if (mounted.current && generation === ownerGeneration.current && !controller.signal.aborted && !(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof DOMException ? 'This folder could not be opened. Try another folder or select its files instead.' : caught instanceof Error ? caught.message : 'Folder selection failed. Select its files instead.');
      }
    } finally {
      if (folderController.current === controller) folderController.current = null;
      if (mounted.current) { setBusy(false); setReadingFolder(false); }
    }
  };
  useEffect(() => {
    if (!capability?.inspection) return;
    const pending = sources.filter(source => source.file && !source.inspection).slice(0, 32);
    if (!pending.length) return;
    const controller = new AbortController();
    void inspectSources(pending, controller.signal).then(results => {
      if (!controller.signal.aborted) setSources(previous => previous.map(source => results.has(source.id) ? { ...source, inspection: results.get(source.id) } : source));
    }).catch(caught => {
      if (controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : 'File inspection failed';
      const ids = new Set(pending.map(source => source.id));
      setSources(previous => previous.map(source => ids.has(source.id) ? { ...source, inspection: { format: 'unavailable', conversions: [], extract: false, error: message } } : source));
      setError(message);
    });
    return () => controller.abort();
  }, [sources, capability]);
  const switchProject = (id: string) => {
    if (busy || recovering || spkBusy || mutation.current || submitting.current || folderController.current || id === projectId) return;
    drafts.current.set(projectId, { sources, selected, target, zipProfile, conversion, qualityMode, metadataPolicy, recursive, groupActions, errors: sourceErrors });
    const draft = drafts.current.get(id);
    setSources(draft?.sources || []); setSelected(draft?.selected || new Set());
    setTarget(draft?.target || 'zip'); setZipProfile(draft?.zipProfile ?? 'balanced'); setZipComment(''); setConversion(draft?.conversion || 'wav');
    setQualityMode(draft?.qualityMode || 'lossless'); setMetadataPolicy(draft?.metadataPolicy || 'strip');
    setRecursive(draft?.recursive || false); setSourceErrors(draft?.errors || {});
    setGroupActions(draft?.groupActions || {});
    setProjectId(id); setPage(0); setScroll(0); setError(''); setJobSelected(new Set());
    currentProject.current = id; setRecoveryNotice('');
    setSelectionKey(draft && capability?.draftScope ? `hamma-selection:${capability.draftScope}:${id}` : '');
    if (capability?.projectRecovery && !draft) void restoreProject(id, capability.draftScope).catch(caught => setError(caught instanceof Error ? caught.message : 'Project could not be restored.'));
  };
  const createProject = async () => {
    if (busy || recovering || spkBusy || projectIds.length >= 20 || accountChanging()) return;
    const id = randomId();
    const generation = ownerGeneration.current;
    const controller = new AbortController(); abort.current = controller;
    try {
      if (capability?.projectRecovery) { setBusy(true); await recovery.current.save(id, defaultProjectSettings, controller.signal); }
      if (generation !== ownerGeneration.current || controller.signal.aborted || !mounted.current) return;
      setProjectIds(previous => [...previous, id]); switchProject(id);
    } catch (caught) { if (generation === ownerGeneration.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Project could not be created.'); }
    finally { setBusy(false); }
  };
  const chosen = useMemo(() => sources.filter(source => selected.has(source.id)), [sources, selected]);
  const missingOriginals = sources.filter(source => !source.file && !source.directory && (!source.upload || source.resume)).length;
  const singleSource = chosen.length === 1 ? chosen[0] : undefined;
  const zipSource = singleSource && !singleSource.directory && (singleSource.inspection && !singleSource.inspection.error
    ? singleSource.inspection.format === 'zip' : /\.zip$/i.test(singleSource.name)) ? singleSource : null;
  const signature = singleSource?.inspection?.format;
  const tarName = singleSource?.name ?? '';
  const tarSource = singleSource && !singleSource.directory && (signature === 'tar'
    || (signature === 'file' || !signature) && /\.tar$/i.test(tarName)
    || (!signature || signature === 'gzip') && /\.(tar\.gz|tgz)$/i.test(tarName)
    || (!signature || signature === 'bzip2') && /\.(tar\.bz2|tbz2?)$/i.test(tarName)
    || (!signature || signature === 'xz') && /\.(tar\.xz|txz)$/i.test(tarName));
  const verificationLabel = zipSource && capability?.zipVerification ? 'Test ZIP integrity'
    : tarSource && capability?.tarVerification ? 'Test TAR integrity' : '';
  const archiveTargets = resolveArchiveTargets(chosen, capability);
  const browserInputs = chosen.every(source => !!source.file && !source.resume);
  const archiveTarget = target === 'spk' && browserInputs || archiveTargets.includes(target) ? target : archiveTargets[0] || 'zip';
  const actions = resolveActions(chosen, capability);
  const canExtract = chosen.length > 0 && chosen.every(source => /\.spk$/i.test(source.name) ? !!source.file && !source.resume && !!spkReady && projectId === 'default' : resolveActions([source], capability).extract);
  const canRepack = capability?.archiveRepack && singleSource && !/\.spk$/i.test(singleSource.name) && canExtract;
  const canInspectOffice = capability?.officeInspection && singleSource && !singleSource.directory &&
    (!singleSource.inspection || singleSource.inspection.error || singleSource.inspection.format === 'zip') &&
    /\.(docx|xlsx|pptx)$/i.test(singleSource.name);
  const conversionTarget = actions.conversions.includes(conversion) ? conversion : actions.conversions[0];
  const comment = archiveTarget === 'zip' && capability?.zipComments ? zipComment : '';
  const submit = async (operation: 'compress' | 'extract' | 'convert' | 'verify' | 'inspect', options: { zipIndexes?: number[]; repack?: boolean; planned?: ExecutionPlan } = {}) => {
    const { zipIndexes, repack, planned } = options;
    const inputs = planned ? planned.groups.flatMap(group => group.sources) : chosen;
    if (accountChanging()) return;
    if (submitting.current || recovering || capability?.projectRecovery && !recoveryReady || spkBusy || !inputs.length) return;
    if (inputs.some(source => !source.file && !source.directory && (!source.upload || source.resume))) {
      setError('Select the original files for recovered selections, or deselect them before running this action.');
      return;
    }
    if (operation === 'convert' && !conversionTarget) return;
    if (operation === 'compress' && !planned && /[^ -~]/.test(comment)) {
      setError('ZIP comments accept printable ASCII characters only.');
      return;
    }
    if (operation === 'verify' && !verificationLabel) return;
    if (operation === 'inspect' && !canInspectOffice) return;
    if (repack && !canRepack) return;
    if (operation === 'convert' && requiresLossyConsent(conversionTarget) && qualityMode !== 'lossy') {
      setError(`${conversionTarget.toUpperCase()} can reduce quality. Choose Allow quality loss before converting.`);
      return;
    }
    const browserOnly = !planned && ((operation === 'compress' && archiveTarget === 'spk') || (operation === 'extract' && chosen.every(source => /\.spk$/i.test(source.name))));
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
    const generation = ownerGeneration.current;
    const submitted = new Set<string>();
    try {
      if (capability.projectRecovery) await recovery.current.save(projectId, { target, conversion, qualityMode, metadataPolicy, recursive, ...(capability.projectZipProfiles ? { zipProfile } : {}), ...(capability.groupedWorkflows ? { groupActions } : {}) }, controller.signal);
      const report = operation === 'verify' || operation === 'inspect';
      const jobTarget = report ? 'json' : operation === 'extract' ? repack ? 'zip-deflate' : 'zip' : operation === 'compress' ? archiveTarget : conversionTarget;
      const plan = planned || summarizePlan([{ id: 'selection', sources: chosen, operation, target: jobTarget, qualityMode, metadataPolicy, recursive }], 0, capability);
      const sourcesByUpload = new Map<string, string>();
      const failures = await executeWorkflow(plan, {
        signal: controller.signal,
        browserExtract: async source => {
          if (source.resume) throw new ProcessorError('Resume this upload with a processor action, or add the file separately for SPK restoration.', 400);
          if (!onSpkSelect || !spkReady || !source.file) throw new Error('SPK engine is not ready.');
          if (!await onSpkSelect([source.file], true)) throw new Error('SPK restoration did not complete.');
        },
        prepare: async source => {
          const recoverOnUpload = capability.projectRecovery && capability.recoverableUploads;
          if (source.resume) setUploadStatus({ name: source.name, offset: source.uploaded ?? 0, size: source.size, checking: true });
          const id = await upload(source, controller.signal, offset => { if (generation === ownerGeneration.current) { source.uploaded = offset; setUploadStatus({ name: source.name, offset, size: source.size }); } }, recoverOnUpload ? projectId : undefined);
          if (capability.projectRecovery && !recoverOnUpload) await recovery.current.checkpoint(projectId, source, controller.signal);
          if (selectionKey) saveSelection(selectionKey, liveSources.current, selected);
          if (!planned && !capability.projectRecovery) sourcesByUpload.set(id, source.id);
          return id;
        },
        queue: async (group, uploads) => {
          const compression = group.operation === 'compress';
          const conversionOptions = group.operation === 'convert' ? { qualityMode: group.qualityMode, metadataPolicy: group.metadataPolicy } : {};
          const nested = !compression && !zipIndexes && !repack && !report && group.recursive && (!planned || group.operation === 'extract');
          const profiles = !planned && compression && group.target === 'zip' && capability.zipProfiles?.includes(zipProfile) && zipProfile !== 'balanced'
            ? { zipProfile } : {};
          const archiveComment = !planned && compression ? comment : '';
          const selection = zipIndexes ? { zipIndexes } : {};
          const identity = planned ? [generation, projectId, uploads, group.operation, group.target, nested, conversionOptions]
            : compression ? [generation, projectId, group.sources.map(source => source.id), group.operation, group.target, ...Object.values(profiles), ...(archiveComment ? [['zipComment', archiveComment]] : [])]
            : [generation, projectId, sourcesByUpload.get(uploads[0]), group.operation, report || repack ? group.target : conversionTarget, nested, conversionOptions, ...(zipIndexes ? [zipIndexes] : [])];
          const pagedSelection = capability.pagedJobSelections && uploads.length > 100;
          const jobInputs = pagedSelection
            ? await stageJobSelection(projectId, uploads, controller.signal)
            : { uploads };
          if (pagedSelection) {
            setUploadStatus(null);
            setCheckingSelection(true);
          }
          try {
            await jsonRequest('/jobs', { ...(projectId === 'default' ? {} : { projectId }), ...jobInputs, operation: group.operation,
              target: group.target, ...(!compression ? { recursive: nested } : {}), ...conversionOptions, ...profiles, ...selection,
              ...(archiveComment ? { zipComment: archiveComment } : {}),
              ...(capability.projectRecovery ? { recoverable: true } : { requestId: await requestId(identity) }) }, 'POST', {
              signal: controller.signal,
              // Hashing a full selection can exceed the normal request timeout.
              timeoutMs: pagedSelection ? Math.max(30000, Math.min(900000, capability.limits.seconds * 1000)) : undefined,
            });
          } finally {
            if (pagedSelection) setCheckingSelection(false);
          }
          if (archiveComment && generation === ownerGeneration.current) setZipComment('');
        },
        submitted: source => {
          submitted.add(source.id);
          setSourceErrors(previous => { const next = { ...previous }; delete next[source.id]; return next; });
        },
        failed: (source, message, group) => {
          const { id, operation, target, qualityMode, metadataPolicy, recursive } = group;
          const retry = planned && operation !== 'compress' ? { id, operation, target, qualityMode, metadataPolicy, recursive } : undefined;
          setSourceErrors(previous => ({ ...previous, [source.id]: { message, retry } }));
        },
      });
      if (failures) setError(`${failures} ${failures === 1 ? 'file could' : 'files could'} not be queued. Review the details beside each file.`);
    } catch (caught) {
      if (generation === ownerGeneration.current) setError(controller.signal.aborted ? 'Upload paused. Select an action to resume.' : caught instanceof Error ? caught.message : 'Could not queue files');
    } finally {
      if (generation !== ownerGeneration.current) submitted.clear();
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
      const results: PromiseSettledResult<void>[] = [];
      for (let offset = 0; offset < chosenJobs.length; offset += 4) results.push(...await Promise.allSettled(chosenJobs.slice(offset, offset + 4).map(async job => {
        if (job.localId) {
          if (operation === '' && method === 'DELETE') removeLocalHistory(job.localId);
          else if (operation === 'files' && method === 'DELETE') deleteOutput(job.localId);
          else throw new Error('This action requires a processor job.');
        } else await action(job, operation, method);
      })));
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
  const retrySource = (source: Source, action: Omit<TaskGroup, 'sources'>) => {
    if (!capability || offline || busy || recovering || spkBusy) return;
    if (action.operation === 'convert' && requiresLossyConsent(action.target) && qualityMode !== 'lossy') {
      setError(`${action.target.toUpperCase()} requires Allow quality loss.`);
      return;
    }
    try {
      const plan = summarizePlan([{ ...action, sources: [source] }], 0, capability);
      void submit('compress', { planned: plan });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not retry this file.');
    }
  };
  const removeSelectedSources = () => {
    const captured = chosen.map(source => ({ ...source }));
    const uploaded = captured.filter(source => source.upload);
    const remove = async () => {
      const outcomes = await Promise.allSettled(uploaded.map(async source => {
        try { await request('/uploads/' + source.upload, { method: 'DELETE' }); }
        catch (caught) { if (!(caught instanceof ProcessorError) || ![404, 410].includes(caught.status)) throw caught; }
      }));
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
  const allActivity = combineActivity(jobs, archives, outputs, downloadsOnly);
  const combined = screen === 'workspace' ? allActivity.filter(job => (job.projectId || 'default') === projectId) : allActivity;
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
      <div className="project-toolbar"><label>Project<SelectField aria-label="Current project" value={projectId} disabled={busy || recovering || !!spkBusy || acting || readingFolder} onChange={switchProject}>{projectIds.map((id, index) => <option key={id} value={id}>{id === 'default' ? 'Project 1' : 'Project ' + (index + 1)}</option>)}</SelectField></label><button className="button secondary" disabled={busy || recovering || !!spkBusy || acting || readingFolder || projectIds.length >= 20} onClick={() => void createProject()}>New project</button></div>
      {recovering && <p className="footnote" role="status">Restoring uploaded files…</p>}
      {recoveryNotice && <p className="footnote" role="status">{recoveryNotice} Files stay available until their upload retention expires.</p>}
      {missingOriginals > 0 && <p className="footnote" role="status">Select the original files to continue {missingOriginals} {missingOriginals === 1 ? 'upload' : 'uploads'}.</p>}
      <div className={`surface universal-drop ${dragging ? 'drag-active' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (busy || recovering || spkBusy) return; void droppedSources(event.dataTransfer, capability?.limits.files).then(add).catch(caught => setError(caught.message)); }}>
        <div className="universal-drop-icon"><FileArchive size={30} strokeWidth={1.2} /></div><h2>Add your files</h2><p>Drop files or folders</p>
        <details className="universal-picker"><summary className="button primary">+ Add Files or Folders</summary><div className="button-row"><button className="button secondary" disabled={busy || recovering || spkBusy} onClick={() => input.current?.click()}><Plus size={16} /> Add Files</button><button className="button secondary" disabled={busy || recovering || spkBusy} onClick={() => void chooseFolder()}><FolderPlus size={16} /> Add Folder</button></div></details>
        <input type="file" multiple className="file-picker-input" tabIndex={-1} ref={input} aria-label="Add files to queue" onChange={event => { const files = Array.from(event.target.files || []); choose(files); if (files.length) setFolderHelp(false); event.target.value = ''; }} />
        <input type="file" multiple className="file-picker-input" tabIndex={-1} ref={folder} {...{ webkitdirectory: '' }} aria-label="Add folder to queue" onChange={event => { const files = Array.from(event.target.files || []); if (files.length) { choose(files); setFolderHelp(!files.some(file => file.webkitRelativePath)); } else setError('No files were selected from this folder. Select its files instead.'); event.target.value = ''; }} />
      </div>
      {folderHelp && !readingFolder && <div className="processor-notice folder-selection-help" role="status"><span>Can’t select the folder? Select the files inside it instead, or add a ZIP.</span><button className="button secondary" disabled={busy || recovering || spkBusy} onClick={() => input.current?.click()}>Select files instead</button><button className="icon-button" aria-label="Dismiss folder help" onClick={() => setFolderHelp(false)}><X size={16} /></button></div>}
      {readingFolder && <div className="upload-status" role="status"><Loader2 size={16} className="animate-spin" /><span>Reading folder…</span><button className="button secondary" onClick={() => folderController.current?.abort()}>Cancel</button></div>}
      {sources.length > 0 && <section className="surface source-panel" aria-label="Selected files">
        <div className="source-toolbar">{sources.some(source => source.inspection?.error) && <button className="button secondary" disabled={busy || !!spkBusy} onClick={() => setSources(previous => previous.map(source => source.inspection?.error ? { ...source, inspection: undefined } : source))}>Retry detection</button>}<label className="selection-label"><input type="checkbox" checked={selected.size === sources.length} onChange={() => setSelected(selected.size === sources.length ? new Set() : new Set(sources.map(s => s.id)))} />Select all</label><span>{selected.size.toLocaleString()} selected · {formatFileSize(chosen.reduce((sum, source) => sum + source.size, 0))}</span><button className="icon-button" disabled={busy || recovering || spkBusy || !selected.size} aria-label="Remove selected files" onClick={removeSelectedSources}><Trash2 size={16} /></button></div>
        <div className="source-scroll" onScroll={event => setScroll(event.currentTarget.scrollTop)}>
          <div style={{ height: sources.length * 64, position: 'relative' }}>
            {rendered.map((source, index) => <div className="source-row" key={source.id} style={{ top: (rowStart + index) * 64 }}>
              <input type="checkbox" aria-label={`Select ${source.name}`} checked={selected.has(source.id)} onChange={() => toggleSource(source.id)} />
              <File size={19} strokeWidth={1.5} />
              <div><strong title={source.name}>{source.name}</strong><span>{source.directory ? 'Empty folder' : formatFileSize(source.size) + (capability?.inspection ? '  -  ' + (source.inspection?.error || source.inspection?.format || 'Detecting - ') : '')}</span></div>
              {!source.directory && (!source.upload && !source.file || source.resume && (source.uploaded ?? 0) < source.size)
                ? <label className="file-state source-reselect" title={sourceErrors[source.id]?.message}>
                  <input type="file" className="sr-only" aria-label={`Select original file for ${source.name}`} disabled={busy || recovering || !!spkBusy} onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) reselect(source, file);
                  }} />
                  {source.file ? 'Change file' : 'Select original'}
                </label>
                : sourceErrors[source.id] ? <span className="source-failure"><button className="file-state source-error" title={sourceErrors[source.id].message} onClick={() => setError(source.name + ': ' + sourceErrors[source.id].message)}>{sourceErrors[source.id].message}</button>{sourceErrors[source.id].retry && <button className="text-button" aria-label={`Retry ${source.name}`} disabled={busy || recovering || !!spkBusy || offline} onClick={() => retrySource(source, sourceErrors[source.id].retry!)}>Retry file</button>}</span>
                : <span className="file-state">Waiting</span>}
            </div>)}
          </div>
        </div>
        {capability?.groupedWorkflows && <GroupedWorkflow key={projectId} sources={chosen} capability={capability} settings={{ qualityMode, metadataPolicy, recursive }} selections={groupActions} onSelectionsChange={setGroupActions} busy={busy || recovering || !!spkBusy || offline || (capability.projectRecovery === true && !recoveryReady)} onQualityChange={setQualityMode} onRun={plan => void submit('compress', { planned: plan })} />}
        {new Set(chosen.map(source => source.inspection?.format).filter(Boolean)).size > 1 && <details className="processing-options"><summary>Actions by file type</summary><div className="button-row">{[...new Set(chosen.map(source => source.inspection?.format).filter((format): format is string => !!format))].map(format => <button className="button secondary" key={format} disabled={busy || !!spkBusy} onClick={() => setSelected(new Set(chosen.filter(source => source.inspection?.format === format).map(source => source.id)))}>Select {format.toUpperCase()} ({chosen.filter(source => source.inspection?.format === format).length})</button>)}</div></details>}
        <div className="processing-actions"><button className="button primary" disabled={busy || recovering || spkBusy || !selected.size || (archiveTarget === 'spk' ? !spkReady || chosen.some(source => source.directory) : !capability || offline)} onClick={() => void submit('compress')}><FileArchive size={16} /> Compress</button>{canExtract && <button className="button secondary" disabled={busy || recovering || spkBusy || !selected.size || chosen.some(s => s.directory) || (chosen.every(source => /\.spk$/i.test(source.name)) ? !spkReady : !capability || offline)} onClick={() => void submit('extract')}><ArrowDownToLine size={16} /> Extract</button>}{actions.conversions.length > 0 && <><button className="button secondary" disabled={busy || recovering || spkBusy || !selected.size || !capability?.conversions.length || offline || chosen.some(s => s.directory)} onClick={() => void submit('convert')}><ArrowRightLeft size={16} /> Convert</button><label className="conversion-select">To<SelectField disabled={busy || recovering || spkBusy} aria-label="Conversion format" value={conversionTarget} onChange={value => setConversion(value)}>{actions.conversions.map(format => <option key={format} value={format}>{format === 'mp4-h264' ? 'MP4 (H.264)' : format}</option>)}</SelectField></label><label className="conversion-select">Quality<SelectField disabled={busy || recovering || spkBusy} aria-label="Conversion quality" value={qualityMode} onChange={value => setQualityMode(value as "lossless" | "lossy")}><option value="lossless">Lossless</option><option value="lossy">Allow quality loss</option></SelectField></label></>}</div>
        {archiveTarget === 'zip' && !!capability?.zipProfiles?.length && <div className="zip-inspection">
          <label className="conversion-select">ZIP compression
            <SelectField aria-label="ZIP compression profile" value={zipProfile} onChange={setZipProfile} disabled={busy || recovering || spkBusy}>
              {capability.zipProfiles.map(profile => <option key={profile} value={profile}>{profile[0].toUpperCase() + profile.slice(1)}</option>)}
            </SelectField>
          </label>
        </div>}
        {archiveTarget === 'zip' && capability?.zipComments && <div className="zip-inspection">
          <details>
            <summary>ZIP comment</summary>
            <label className="search-field"><input aria-label="ZIP archive comment" placeholder="Optional archive comment"
              value={zipComment} maxLength={1024} disabled={busy || recovering || spkBusy}
              onChange={event => setZipComment(event.target.value)} /></label>
            <p className="footnote">The ZIP stores this comment in plain text. Use up to 1,024 printable ASCII characters.</p>
          </details>
        </div>}
        {visible && zipSource?.file && <ZipInspection key={projectId + ':' + zipSource.id} file={zipSource.file}
          disabled={busy || recovering || spkBusy || offline}
          onExtract={capability?.zipSelection ? indexes => void submit('extract', { zipIndexes: indexes }) : undefined} />}
        {canRepack && <div className="zip-inspection">
          <button className="button secondary" disabled={busy || recovering || spkBusy || offline}
            onClick={() => void submit('extract', { repack: true })}><FileArchive size={16} /> Repack as ZIP</button>
        </div>}
        {canInspectOffice && <div className="zip-inspection">
          <button className="button secondary" disabled={busy || recovering || spkBusy || offline}
            onClick={() => void submit('inspect')}><File size={16} /> Inspect Office document</button>
          <p className="footnote">Uploads the document and returns a package metadata report.</p>
        </div>}
        {verificationLabel && <div className="zip-inspection">
          <button className="button secondary" disabled={busy || recovering || spkBusy || offline} onClick={() => void submit('verify')}><ShieldCheck size={16} /> {verificationLabel}</button>
          <p className="footnote">Uploads the archive to the processor for a downloadable integrity report.</p>
        </div>}
      </section>}
      {capability?.inspection && sources.length > 0 && <p className="footnote">File detection sends the first 512 bytes to your processor. Processor jobs upload full files. ZIP inspection runs in this browser.</p>}
      {capability && !capability.conversions.length && <p className="footnote">Media conversion is unavailable until FFmpeg and FFprobe are installed on the computer running HAMMA.</p>}
      {uploadStatus && <div className="upload-status" role="status"><Loader2 size={16} className="animate-spin" /><span>{uploadStatus.name}<small>{uploadStatus.checking ? 'Checking saved bytes…' : `${formatFileSize(uploadStatus.offset)} / ${formatFileSize(uploadStatus.size)}`}</small></span><progress aria-label="Upload progress" value={uploadStatus.offset} max={Math.max(1, uploadStatus.size)} /><button className="icon-button" aria-label="Pause upload" onClick={() => abort.current?.abort()}><Pause size={16} /></button></div>}
      {checkingSelection && <p className="footnote" role="status">Checking files before queueing…</p>}
      <details className="processing-options"><summary>Options</summary><div className="options-grid"><label>Archive<SelectField disabled={busy || recovering || spkBusy} value={archiveTarget} onChange={value => setTarget(value)} aria-label="Archive format">{[...archiveTargets, ...(onSpkSelect && projectId === 'default' && browserInputs ? ['spk'] : [])].map(format => <option key={format}>{format}</option>)}</SelectField></label><label>Conversion metadata<SelectField disabled={busy || recovering || spkBusy} aria-label="Conversion metadata" value={metadataPolicy} onChange={value => setMetadataPolicy(value as "strip" | "preserve")}><option value="strip">Remove metadata</option><option value="preserve">Preserve supported tags</option></SelectField></label><label className="selection-label"><input type="checkbox" disabled={busy || recovering || spkBusy} checked={recursive} onChange={event => setRecursive(event.target.checked)} /> Open nested archives</label></div><p>Nested originals are kept alongside their contents. MP4, MKV, and WebM preserve streams when compatible. Lossy conversion requires Allow quality loss. Metadata is removed by default; preservation depends on the output format.</p></details>
    </>}
    {screen === 'workspace' && spkStatus}
    <section className="processing-history" aria-label="Processing jobs">
      <ErrorCenter jobs={combined} busy={acting} retry={records => void bulk('retry', 'POST', records).catch(caught => setError(caught.message))} />
      <div className="section-line"><h2>{screen === 'workspace' ? 'Processing queue' : screen === 'files' ? 'Available files' : 'All operations'}</h2><div className="button-row">{screen === 'workspace' && <button className="text-button" onClick={onHistory}><History size={14} /> History</button>}<button className="text-button" onClick={() => void exportHistory()} disabled={!combined.length}><Download size={14} /> Export</button></div></div>
      {screen === 'workspace' && combined.length > 0 && <div className="project-summary" role="status"><span>{combined.filter(job => job.state === 'completed').length} completed  -  {combined.filter(job => ['failed', 'interrupted'].includes(job.state)).length} failed  -  {combined.filter(activeJob).length} remaining jobs</span><div className="button-row"><button className="button secondary" disabled={acting || !combined.some(job => job.state === 'queued')} onClick={() => void bulk('pause', 'POST', combined.filter(job => job.state === 'queued')).catch(caught => setError(caught.message))}>Pause waiting</button><button className="button secondary" disabled={acting || !combined.some(job => job.state === 'paused')} onClick={() => void bulk('resume', 'POST', combined.filter(job => job.state === 'paused')).catch(caught => setError(caught.message))}>Resume waiting</button><button className="button secondary" disabled={acting || !combined.some(activeJob)} onClick={() => void bulk('cancel', 'POST', combined.filter(activeJob)).catch(caught => setError(caught.message))}>Cancel project jobs</button><button className="button secondary" disabled={acting || !combined.some(job => ['failed', 'interrupted'].includes(job.state))} onClick={() => void bulk('retry', 'POST', combined.filter(job => ['failed', 'interrupted'].includes(job.state))).catch(caught => setError(caught.message))}>Retry failed</button><button className="button secondary" disabled={!combined.some(job => job.downloadAvailable)} onClick={() => combined.filter(job => job.downloadAvailable).forEach(download)}>Download completed</button></div><small>Progress counts verified jobs. File selections stay in this tab; queued jobs survive a server restart.</small></div>}
      <div className="history-tools universal-search"><label className="search-field"><Search size={16} /><input aria-label="Search processing history" placeholder="Search files" value={query} onChange={event => { setQuery(event.target.value); setPage(0); setJobSelected(new Set()); }} /></label><SelectField aria-label="Filter processing history" value={filter} onChange={value => { setFilter(value); setPage(0); setJobSelected(new Set()); }}><option value="">All statuses</option>{['queued', 'processing', 'verifying', 'completed', 'failed', 'cancelled', 'interrupted', 'paused'].map(state => <option value={state} key={state}>{label(state)}</option>)}</SelectField><SelectField aria-label="Filter by operation" value={operationFilter} onChange={value => { setOperationFilter(value); setPage(0); setJobSelected(new Set()); }}><option value="">All operations</option><option value="compress">Compression</option><option value="extract">Extraction</option><option value="convert">Conversion</option><option value="downloads">Available downloads</option></SelectField><SelectField aria-label="Sort processing history" value={sort} onChange={value => { setSort(value); setPage(0); setJobSelected(new Set()); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="size">Largest first</option></SelectField></div>
      {visibleJobs.length > 0 && <div className="job-bulk"><label className="selection-label"><input aria-label="Select all visible jobs" type="checkbox" checked={visibleJobs.every(j => jobSelected.has(j.id))} onChange={event => setJobSelected(event.target.checked ? new Set(visibleJobs.map(j => j.id)) : new Set())} />Select all</label><span>{visibleJobs.filter(j => j.state === 'completed').length} completed · {visibleJobs.filter(j => ['failed', 'interrupted'].includes(j.state)).length} failed · {visibleJobs.filter(activeJob).length} remaining on this page</span></div>}
      {jobSelected.size > 0 && <div className="processing-actions bulk-actions"><button className="button secondary" disabled={!selectedJobs.some(j => j.downloadAvailable)} onClick={() => selectedJobs.filter(j => j.downloadAvailable).forEach(download)}><Download size={14} /> Download</button><button className="button secondary" disabled={!selectedJobs.every(j => j.state === 'queued')} onClick={() => void bulk('pause').catch(e => setError(e.message))}><Pause size={14} /> Pause queue</button><button className="button secondary" disabled={!selectedJobs.every(j => j.state === 'paused')} onClick={() => void bulk('resume').catch(e => setError(e.message))}><Play size={14} /> Resume</button><button className="button secondary" disabled={!selectedJobs.every(activeJob)} onClick={() => void bulk('cancel').catch(e => setError(e.message))}><X size={14} /> Cancel</button><button className="button secondary" disabled={!selectedJobs.every(j => ['failed', 'interrupted', 'cancelled'].includes(j.state))} onClick={() => void bulk('retry').catch(e => setError(e.message))}><RefreshCw size={14} /> Retry</button><button className="button secondary" disabled={busy || recovering || spkBusy || acting || preparingDeletion || !selectedJobs.every(terminal)} onClick={() => confirmBulk('')}><Trash2 size={14} /> Delete history</button><button className="button secondary" disabled={busy || recovering || spkBusy || acting || preparingDeletion || !selectedJobs.length || !selectedJobs.every(job => terminal(job) && (!job.localId || job.downloadAvailable))} onClick={() => confirmBulk('files')}><Trash2 size={14} /> Delete files</button></div>}
      <div className="surface job-list" aria-busy={loadingJobs && !offline}>{loadingJobs && !offline && <p className="queue-loading" role="status"><Loader2 size={16} className="animate-spin" /> Loading your jobs</p>}{visibleJobs.length ? visibleJobs.map(job => <article className="processing-job" key={job.id}>
        <div className="processing-job-line"><input type="checkbox" aria-label={`Select job ${job.name}`} checked={jobSelected.has(job.id)} onChange={() => setJobSelected(previous => { const next = new Set(previous); next.has(job.id) ? next.delete(job.id) : next.add(job.id); return next; })} /><span className="job-glyph" data-state={job.state === 'completed' ? 'done' : activeJob(job) && job.state !== 'queued' && job.state !== 'paused' ? 'working' : 'idle'} aria-hidden="true"><Check size={18} className="job-icon-done" /><span className="job-icon-working"><Loader2 size={18} className="animate-spin" /></span><FileArchive size={18} className="job-icon-idle" /></span><div className="processing-job-name"><strong title={job.name}>{job.outputName || job.name}</strong><span><b className={`operation-tag tag-${job.operation}`}>{job.localId ? 'SPK' : (job.target || job.format || 'file').toUpperCase()} / {job.operation}</b> · {formatFileSize(job.inputSize)}{job.outputSize !== null ? ` → ${formatFileSize(job.outputSize)}` : ''}{job.operation === 'compress' && job.outputSize !== null && job.inputSize > 0 ? ` · ${savings(job)}` : ''}</span></div><span className={`file-state state-${job.state}`} role="status">{label(job.state)}</span>{job.downloadAvailable && (job.localId ? <a className="icon-button" href={job.download} download={job.outputName} aria-label={`Download ${job.outputName}`} title="Download"><Download size={17} /><span className="sr-only">Download</span></a> : <button className="icon-button" aria-label={`Download ${job.outputName}`} title="Download" onClick={() => download(job)}><Download size={17} /><span className="sr-only">Download</span></button>)}{activeJob(job) && <button className="icon-button" aria-label={`Cancel ${job.name}`} onClick={() => runAction(job, 'cancel')}><X size={16} /></button>}{['failed', 'interrupted', 'cancelled'].includes(job.state) && <button className="icon-button" aria-label={`Retry ${job.name}`} onClick={() => runAction(job, 'retry')}><RefreshCw size={16} /></button>}</div>
        {activeJob(job) && <div className="job-measurement">{job.operation === 'compress' && job.state === 'processing' ? <><progress aria-label={`Progress for ${job.name}`} max={Math.max(1, job.inputSize)} value={Math.min(job.inputSize, job.processed)} /><span>{formatFileSize(job.processed)} / {formatFileSize(job.inputSize)}</span></> : <span>{job.state === 'verifying' ? 'Checking output' : job.expanded ? `${job.entries} entries · ${formatFileSize(job.expanded)} expanded` : job.mediaSeconds ? `${job.mediaSeconds.toFixed(1)}s converted · track ${job.track}/${job.tracks}` : label(job.state)}</span>}</div>}
        {job.error && <p className="job-error">{job.error}</p>}
        {job.manifestStorage && job.downloadAvailable && <VerifiedFiles jobId={job.id} />}
        <details className="job-details"><summary>Details</summary><dl><dt>Job</dt><dd>{job.id}</dd><dt>Input</dt><dd>{job.format} · {job.fileCount} entries</dd><dt>Created</dt><dd>{new Date(job.created * 1000).toLocaleString()}</dd><dt>Finished</dt><dd>{job.finished != null ? new Date(job.finished * 1000).toLocaleString() : job.localId ? new Date(job.created * 1000).toLocaleString() : "—"}</dd><dt>Duration</dt><dd>{job.duration === undefined || job.duration === null ? '—' : `${job.duration.toFixed(2)}s`}</dd><dt>Files expire</dt><dd>{job.localId ? job.savedToDevice ? 'Saved directly to your device' : job.downloadAvailable ? 'Available until this page closes or you delete it' : 'Not retained in this browser' : new Date(job.fileExpires * 1000).toLocaleString()}</dd><dt>History expires</dt><dd>{job.historyExpires ? new Date(job.historyExpires * 1000).toLocaleString() : 'Never'}</dd></dl>{job.localId && job.localId !== 'current' && <button className="text-button" onClick={() => confirmLocalHistory(job.localId!)}><Trash2 size={14} /> Remove record</button>}</details>
      </article>) : (!loadingJobs || offline) && <div className="processing-empty"><History size={22} strokeWidth={1.3} /><p>{query || filter || operationFilter ? 'No matching files' : screen === 'files' ? 'No downloads available' : 'No jobs yet'}</p></div>}</div>
      <div className="history-pagination"><span>{total.toLocaleString()} operations</span><div><button className="icon-button" aria-label="Previous history page" disabled={!page} onClick={() => { setPage(page - 1); setJobSelected(new Set()); }}><ChevronLeft size={17} /></button><span>{page + 1} / {Math.max(1, Math.ceil(total / 50))}</span><button className="icon-button" aria-label="Next history page" disabled={(page + 1) * 50 >= total} onClick={() => { setPage(page + 1); setJobSelected(new Set()); }}><ChevronRight size={17} /></button></div></div>
    </section>
    {screen === 'history' && <details className="processing-options"><summary>Retention</summary><div className="options-grid"><label>History<SelectField disabled={savingRetention || offline} aria-label="History retention" value={retention.historyRetention} onChange={value => void saveRetention({ ...retention, historyRetention: value })}>{[['24h', '24 Hours'], ['7d', '7 Days'], ['30d', '30 Days'], ['never', 'Never']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</SelectField></label><label>Files<SelectField disabled={savingRetention || offline} aria-label="File retention" value={retention.fileRetention} onChange={value => void saveRetention({ ...retention, fileRetention: value })}>{[['24h', '24 Hours'], ['7d', '7 Days'], ['30d', '30 Days']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</SelectField></label></div><p>Applies to new jobs. Deleting history keeps files until their expiry. Deleting files removes inputs and outputs when no other job uses them. Downloaded copies stay on your device. Browser SPK outputs stay available until you close this page or delete them.</p><div className="button-row"><button className="button secondary" disabled={busy || recovering || spkBusy || acting || preparingDeletion || ((!capability || offline) && !archives.length && !legacyHistory.length && !Object.keys(outputs).length)} onClick={() => void confirmClear('history')}><Trash2 size={14} /> Clear history</button><button className="button secondary" disabled={busy || recovering || spkBusy || acting || preparingDeletion || ((!capability || offline) && !Object.values(outputs).some(output => output.downloadUrl))} onClick={() => void confirmClear('files')}><Trash2 size={14} /> Delete all files</button></div></details>}
    {confirmation && <ConfirmAction {...confirmation} onCancel={() => setConfirmation(null)} />}
  </section>;
}
