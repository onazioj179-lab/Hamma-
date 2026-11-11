import { jsonRequest, ProcessorError, request, type Source } from './client';

export interface ProjectSettings {
  zipProfile?: string;
  groupActions?: Record<string, string>;
  target: string; conversion: string; qualityMode: 'lossless' | 'lossy';
  metadataPolicy: 'strip' | 'preserve'; recursive: boolean;
}
export interface SavedProject { id: string; created: number; updated: number; revision: number; settings: ProjectSettings }
export const defaultProjectSettings: ProjectSettings = { target: 'zip', conversion: 'wav', qualityMode: 'lossless', metadataPolicy: 'strip', recursive: false };
const sameSettings = (left: ProjectSettings, right: ProjectSettings) =>
  (Object.keys(defaultProjectSettings) as (keyof ProjectSettings)[]).every(key => left[key] === right[key]) &&
  (left.zipProfile === undefined || left.zipProfile === (right.zipProfile ?? 'balanced')) &&
  JSON.stringify(Object.entries(left.groupActions || {}).sort()) === JSON.stringify(Object.entries(right.groupActions || {}).sort());

/** One instance per owner. No file bytes, cookies or credentials in browser storage. */
export class ProjectRecovery {
  private records = new Map<string, SavedProject>();
  private saves = new Map<string, Promise<SavedProject>>();

  async list(signal?: AbortSignal): Promise<SavedProject[]> {
    const result = await request<{ projects: SavedProject[] }>('/projects', { signal });
    if (!Array.isArray(result.projects) || result.projects.length > 20) throw new Error('Invalid project recovery response');
    for (const project of result.projects) this.records.set(project.id, project);
    return result.projects;
  }

  save(id: string, settings: ProjectSettings, signal?: AbortSignal): Promise<SavedProject> {
    const task = (this.saves.get(id)?.catch(() => undefined) || Promise.resolve()).then(() => this.saveNow(id, settings, signal));
    this.saves.set(id, task);
    void task.finally(() => { if (this.saves.get(id) === task) this.saves.delete(id); }).catch(() => {});
    return task;
  }

  private async saveNow(id: string, settings: ProjectSettings, signal?: AbortSignal): Promise<SavedProject> {
    signal?.throwIfAborted();
    const previous = this.records.get(id);
    if (previous && sameSettings(settings, previous.settings)) return previous;
    try {
      const record = await jsonRequest<SavedProject>('/projects/' + id, { settings, revision: previous?.revision || 0 }, 'PUT', { signal });
      this.records.set(id, record);
      return record;
    } catch (error) {
      // A committed save can lose its response. Reconcile its revision before a retry.
      if (error instanceof ProcessorError && error.status === 409) {
        const current = await request<SavedProject>('/projects/' + id, { signal });
        this.records.set(id, current);
        if (sameSettings(settings, current.settings)) return current;
      }
      throw error;
    }
  }

  get(id: string) { return this.records.get(id); }

  async sources(id: string, signal?: AbortSignal): Promise<{ sources: Source[]; unavailable: number }> {
    const sources: Source[] = [];
    let cursor = '', unavailable = 0;
    while (true) {
      const page = await request<{ sources: Omit<Source, 'file'>[]; total: number; scanned: number; unavailable: number; nextCursor: string | null }>(`/projects/${id}/inputs?after=${cursor}&limit=100&includeIncomplete=1`, { signal });
      if (!Array.isArray(page.sources) || page.sources.length > 100 || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 5000 || !Number.isSafeInteger(page.scanned) || page.scanned < 0 || page.scanned > 100) throw new Error('Invalid project recovery page');
      sources.push(...page.sources.map(source => ({ ...source, file: null, ...(source.uploaded !== undefined && source.uploaded < source.size ? { resume: true } : {}) })));
      if (sources.length > 5000 || !Number.isSafeInteger(page.unavailable) || page.unavailable < 0 || page.unavailable > page.scanned) throw new Error('Invalid project recovery page');
      unavailable += page.unavailable;
      if (page.nextCursor === null) break;
      if (!page.scanned || !/^[a-f0-9]{32}$/.test(page.nextCursor) || page.nextCursor <= cursor) throw new Error('Project recovery made no progress. Reconnect and try again.');
      cursor = page.nextCursor;
    }
    return { sources, unavailable };
  }

  async checkpoint(id: string, source: Source, signal?: AbortSignal): Promise<void> {
    if (!source.upload) throw new Error('Upload this file before saving a recovery point.');
    await jsonRequest(`/projects/${id}/inputs/${source.id}`, { upload: source.upload }, 'PUT', { signal });
  }

  async forget(id: string, sources: Source[]): Promise<void> {
    // Bounded requests; successful removals remain removed if a later one fails.
    for (const source of sources) if (source.upload) await request(`/projects/${id}/inputs/${source.id}`, { method: 'DELETE' });
  }
}
