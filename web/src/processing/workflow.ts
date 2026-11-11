import { ProcessorError, type Source } from './client';
import type { ExecutionPlan, TaskGroup } from './planner';

export interface WorkflowHooks {
  signal: AbortSignal;
  prepare: (source: Source) => Promise<string>;
  queue: (group: TaskGroup, inputs: string[]) => Promise<void>;
  submitted: (source: Source) => void;
  failed: (source: Source, message: string) => void;
  browserExtract?: (source: Source) => Promise<void>;
}

const fileRejection = (error: unknown) => error instanceof ProcessorError && [400, 413, 415, 422].includes(error.status);

/** Bounded execution: one upload at a time, rotating fairly through active groups.
 * Archives stay atomic. A rejected archive input never produces a silently incomplete archive.
 */
export async function executeWorkflow(plan: ExecutionPlan, hooks: WorkflowHooks): Promise<number> {
  if (plan.issues.length) throw new Error(plan.issues.join(' '));
  let failures = 0;
  const rejected = (source: Source, error: unknown) => {
    failures++; hooks.failed(source, error instanceof Error ? error.message : 'This file could not be queued.');
  };
  let active = plan.groups.map(group => ({ group, next: 0, inputs: [] as string[] }));
  while (active.length) {
    const waiting: typeof active = [];
    for (const state of active) {
      const { group } = state;
      hooks.signal.throwIfAborted();
      const source = group.sources[state.next++];
      if (group.operation === 'compress') {
        try { state.inputs.push(await hooks.prepare(source)); }
        catch (error) {
          if (hooks.signal.aborted || !fileRejection(error)) throw error;
          rejected(source, error); continue; // Keep the whole archive group unsubmitted.
        }
        if (state.next < group.sources.length) { waiting.push(state); continue; }
        hooks.signal.throwIfAborted();
        try { await hooks.queue(group, state.inputs); }
        catch (error) {
          if (hooks.signal.aborted || !fileRejection(error)) throw error;
          group.sources.forEach(source => rejected(source, error)); continue;
        }
        group.sources.forEach(hooks.submitted);
      } else {
        try {
          if (group.operation === 'extract' && /\.spk$/i.test(source.name) && hooks.browserExtract) await hooks.browserExtract(source);
          else {
            const input = await hooks.prepare(source);
            hooks.signal.throwIfAborted();
            await hooks.queue(group, [input]);
          }
          hooks.submitted(source);
        } catch (error) {
          if (hooks.signal.aborted || !fileRejection(error)) throw error;
          rejected(source, error);
        }
        if (state.next < group.sources.length) waiting.push(state);
      }
    }
    active = waiting;
  }
  return failures;
}
