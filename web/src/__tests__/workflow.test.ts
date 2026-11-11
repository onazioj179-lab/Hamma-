import { expect, it, vi } from 'vitest';
import { executeWorkflow, type WorkflowHooks } from '../processing/workflow';
import { ProcessorError, type Source } from '../processing/client';
import type { ExecutionPlan, TaskGroup } from '../processing/planner';

const source = (id: string): Source => ({ id, name: id, file: new File(['bytes'], id), size: 5, directory: false });
const group = (id: string, ids: string[], operation: TaskGroup['operation'] = 'convert'): TaskGroup => ({ id, sources: ids.map(source), operation, target: operation === 'convert' ? 'png' : 'zip', qualityMode: 'lossless', metadataPolicy: 'strip', recursive: false });
const plan = (groups: TaskGroup[]): ExecutionPlan => ({ groups, issues: [], skipped: 0, fileCount: groups.reduce((sum, group) => sum + group.sources.length, 0), jobCount: groups.length, inputBytes: 0, remainingUploadBytes: 0, outputLimitPerJob: 1000 });
const hooks = (): WorkflowHooks => ({ signal: new AbortController().signal, prepare: vi.fn(async source => source.id), queue: vi.fn(async () => {}), submitted: vi.fn(), failed: vi.fn() });

it('queues each independent input before uploading the next and preserves archive grouping', async () => {
  const events: string[] = [], run = hooks();
  run.prepare = async source => { events.push('upload:' + source.id); return source.id; };
  run.queue = async (_group, inputs) => { events.push('queue:' + inputs.join(',')); };
  await executeWorkflow(plan([group('images', ['a', 'b']), group('docs', ['c', 'd'], 'compress')]), run);
  expect(events).toEqual(['upload:a', 'queue:a', 'upload:c', 'upload:b', 'queue:b', 'upload:d', 'queue:c,d']);
  expect(run.submitted).toHaveBeenCalledTimes(4);
});

it('isolates 14 rejected submissions in a 300-file workflow', async () => {
  const run = hooks();
  run.queue = vi.fn(async (_group, ids) => { if (Number(ids[0]) < 14) throw new ProcessorError('Unsupported fixture', 415); });
  expect(await executeWorkflow(plan([group('images', Array.from({ length: 300 }, (_, index) => String(index)))]), run)).toBe(14);
  expect(run.submitted).toHaveBeenCalledTimes(286);
  expect(run.failed).toHaveBeenCalledTimes(14);
  expect(run.queue).toHaveBeenCalledTimes(300);
});

it('never submits an incomplete archive and continues unrelated groups', async () => {
  const run = hooks();
  run.prepare = vi.fn(async source => { if (source.id === 'bad') throw new ProcessorError('Unreadable file', 422); return source.id; });
  await executeWorkflow(plan([group('archive', ['good', 'bad', 'later'], 'compress'), group('image', ['independent'])]), run);
  expect(run.queue).toHaveBeenCalledTimes(1);
  expect(vi.mocked(run.queue).mock.calls[0][1]).toEqual(['independent']);
  expect(run.submitted).toHaveBeenCalledTimes(1);
  expect(vi.mocked(run.submitted).mock.calls[0][0].id).toBe('independent');
});

it('stops on capacity failures while preserving already submitted work', async () => {
  const run = hooks();
  run.queue = vi.fn(async (_group, ids) => { if (ids[0] === 'b') throw new ProcessorError('Queue full', 429); });
  await expect(executeWorkflow(plan([group('images', ['a', 'b', 'c'])]), run)).rejects.toMatchObject({ status: 429 });
  expect(run.prepare).toHaveBeenCalledTimes(2);
  expect(run.submitted).toHaveBeenCalledTimes(1);
  expect(run.failed).not.toHaveBeenCalled();
});

it('honors cancellation after upload and refuses invalid plans before any work', async () => {
  const controller = new AbortController(), run = hooks();
  run.signal = controller.signal;
  run.prepare = vi.fn(async source => { controller.abort(); return source.id; });
  await expect(executeWorkflow(plan([group('images', ['a', 'b'])]), run)).rejects.toMatchObject({ name: 'AbortError' });
  expect(run.queue).not.toHaveBeenCalled();
  const invalid = { ...plan([]), issues: ['Unsupported route'] }, clean = hooks();
  await expect(executeWorkflow(invalid, clean)).rejects.toThrow('Unsupported route');
  expect(clean.prepare).not.toHaveBeenCalled();
});
