import { requiresLossyConsent, resolveActions, resolveArchiveTargets } from './actions';
import type { Capability, Source } from './client';

export type Operation = 'compress' | 'extract' | 'convert' | 'verify' | 'inspect' | 'split' | 'join';
export interface WorkflowSettings { qualityMode: 'lossless' | 'lossy'; metadataPolicy: 'strip' | 'preserve'; recursive: boolean }
export interface TaskGroup extends WorkflowSettings { id: string; sources: Source[]; operation: Operation; target: string }
export interface ExecutionPlan {
  groups: TaskGroup[]; skipped: number; issues: string[]; fileCount: number; jobCount: number;
  inputBytes: number; remainingUploadBytes: number; outputLimitPerJob: number;
}
export interface GroupChoice { id: string; label: string; operation: Operation; target: string }
export interface CapabilityGroup { id: string; label: string; sources: Source[]; choices: GroupChoice[] }

/** Inspect metadata already supplied by the registry. Never read or decode file contents here. */
export function capabilityGroups(sources: Source[], capability: Capability): CapabilityGroup[] {
  const groups = new Map<string, Source[]>();
  for (const source of sources) {
    const key = source.directory ? 'folders' : source.inspection?.error ? 'unreadable' : source.inspection?.format || 'unclassified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(source);
  }
  return [...groups].map(([id, entries]) => {
    const actions = resolveActions(entries, capability);
    const choices: GroupChoice[] = id === 'unreadable' ? [] : [
      ...resolveArchiveTargets(entries, capability).map(target => ({ id: `compress:${target}`, label: `Archive as ${target.toUpperCase()}`, operation: 'compress' as const, target })),
      ...(actions.extract ? [{ id: 'extract:zip', label: 'Extract to ZIP', operation: 'extract' as const, target: 'zip' }] : []),
      ...actions.conversions.map(target => ({ id: `convert:${target}`, label: `Convert to ${target.toUpperCase()}`, operation: 'convert' as const, target })),
    ];
    return { id, label: id === 'folders' ? 'Folders' : id === 'file' ? 'Other files' : id === 'unclassified' ? 'Unidentified files' : id === 'unreadable' ? 'Unreadable files' : id.toUpperCase(), sources: entries, choices };
  });
}

export function summarizePlan(groups: TaskGroup[], skipped: number, capability: Capability, issues: string[] = []): ExecutionPlan {
  const sources = groups.flatMap(group => group.sources);
  const ids = new Set<string>();
  let inputBytes = 0, remainingUploadBytes = 0, jobCount = 0;
  for (const group of groups) {
    if (!group.sources.length) throw new Error('A processing group cannot be empty.');
    jobCount += group.operation === 'compress' ? 1 : group.sources.length;
    for (const source of group.sources) {
      if (ids.has(source.id)) throw new Error('A file can appear only once in this workflow.');
      ids.add(source.id);
      if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > capability.limits.input) throw new Error('A file exceeds the processing input limit.');
      inputBytes += source.size;
      remainingUploadBytes += Math.max(0, source.size - (source.uploaded || 0));
    }
  }
  if (ids.size + skipped > capability.limits.files || !Number.isSafeInteger(inputBytes)) throw new Error('This selection exceeds the processing limits.');
  return { groups, skipped, issues, fileCount: sources.length, jobCount, inputBytes, remainingUploadBytes, outputLimitPerJob: capability.limits.expanded };
}

/** Each group requires an explicit user-selected compatible action. No automatic lossy route. */
export function planGroupedWorkflow(groups: CapabilityGroup[], selections: Record<string, string>, settings: WorkflowSettings, capability: Capability): ExecutionPlan {
  const tasks: TaskGroup[] = [], issues: string[] = [];
  let skipped = 0;
  for (const group of groups) {
    const selection = selections[group.id];
    if (!selection || selection === 'skip') { skipped += group.sources.length; continue; }
    const choice = group.choices.find(choice => choice.id === selection);
    if (!choice) { issues.push(`${group.label}: choose a compatible action again.`); skipped += group.sources.length; continue; }
    if (choice.operation === 'convert' && requiresLossyConsent(choice.target) && settings.qualityMode !== 'lossy') {
      issues.push(`${choice.target.toUpperCase()} requires Allow quality loss.`);
      skipped += group.sources.length; continue;
    }
    tasks.push({ id: group.id, sources: group.sources, operation: choice.operation, target: choice.target, ...settings });
  }
  return summarizePlan(tasks, skipped, capability, issues);
}
