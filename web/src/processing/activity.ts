import type { RecentArchive, SessionOutput } from '../store/app';
import { activeJob, request, type Job } from './client';

export interface ActivityJob extends Job { localId?: string; savedToDevice?: boolean; historyHidden?: boolean }

// Fetch the whole retained session so sorting and pagination include both engines.
export async function loadJobs(signal?: AbortSignal, includeHiddenDownloads = false): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let offset = 0; ; ) {
    const result = await request<{ jobs: Job[]; total: number }>(`/jobs?offset=${offset}&limit=100${includeHiddenDownloads ? '&includeHiddenDownloads=1' : ''}`, { signal });
    jobs.push(...result.jobs);
    offset += result.jobs.length;
    if (!result.jobs.length || offset >= result.total) return jobs;
  }
}

export interface JobHistorySnapshot {
  revision: string;
  records: Job[];
  refreshAt: number;
}

export async function refreshJobHistory(previous: JobHistorySnapshot | null, signal: AbortSignal): Promise<JobHistorySnapshot> {
  const query = previous ? '?revision=' + encodeURIComponent(previous.revision) : '';
  const live = await request<{ revision: string; now: number; jobs: Job[] | null }>('/jobs/live' + query, { signal });
  if (previous && live.revision === previous.revision && live.jobs && live.now < previous.refreshAt) {
    if (!live.jobs.length && !previous.records.some(activeJob)) return previous;
    return { ...previous, records: [...live.jobs, ...previous.records.filter(job => !activeJob(job))] };
  }
  const records = await loadJobs(signal, true);
  // Signed links last at most an hour and can expire earlier with their file.
  const refreshAt = records.reduce((next, job) => job.downloadAvailable ? Math.min(next, job.fileExpires) : next, live.now + 1800);
  return { revision: live.revision, records, refreshAt };
}

export function combineActivity(jobs: Job[], archives: RecentArchive[], outputs: Record<string, SessionOutput> = {}, includeHidden = false): ActivityJob[] {
  const entries = new Map(archives.map(entry => [entry.id, entry]));
  for (const [id, output] of Object.entries(outputs)) {
    if (output.hidden && !includeHidden) entries.delete(id);
    else entries.set(id, output.archive);
  }
  const local: ActivityJob[] = [...entries.values()].map(entry => {
    const output = outputs[entry.id];
    const restore = entry.type === 'decompress';
    return {
      id: `spk:${entry.id}`, localId: entry.id, name: entry.fileName,
      operation: restore ? 'extract' : 'compress', target: 'spk', format: 'spk',
      outputName: output?.outputName || entry.outputName, download: output?.downloadUrl || undefined,
      duration: entry.duration === undefined ? undefined : entry.duration / 1000, savedToDevice: output?.savedToDevice, historyHidden: output?.hidden,
      state: 'completed', inputSize: restore ? entry.compressedSize : entry.originalSize,
      outputSize: restore ? entry.originalSize : entry.compressedSize,
      processed: 0, created: entry.date / 1000, entries: entry.fileCount || 1, fileCount: entry.fileCount || 1,
      downloadAvailable: !!output?.downloadUrl, fileExpires: 0, historyExpires: null,
    };
  });
  return [...new Map([...jobs.filter(job => !job.hidden || includeHidden), ...local].map(job => [job.id, job])).values()];
}

export function filterActivity(jobs: ActivityJob[], query: string, state: string, sort: string): ActivityJob[] {
  const needle = query.trim().toLowerCase();
  return jobs.filter(job => (!state || job.state === state) &&
    `${job.name} ${job.outputName || ''} ${job.id} ${job.operation} ${job.target}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === 'oldest' ? a.created - b.created : sort === 'name' ?
      (a.outputName || a.name).localeCompare(b.outputName || b.name) : sort === 'size' ?
      b.inputSize - a.inputSize : b.created - a.created) || a.id.localeCompare(b.id));
}
