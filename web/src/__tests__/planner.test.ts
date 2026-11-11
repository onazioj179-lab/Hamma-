import { expect, it } from 'vitest';
import { capabilityGroups, planGroupedWorkflow, summarizePlan } from '../processing/planner';
import type { Capability, Source } from '../processing/client';

const caps: Capability = { version: 1, processing: 'local', inspection: true, archives: ['zip', 'gzip'], singleFileArchives: ['gzip'], conversions: ['png', 'jpg', 'wav', 'mp3', 'mkv'], limits: { input: 1000, expanded: 2000, files: 5000, seconds: 60 } };
const settings = { qualityMode: 'lossless' as const, metadataPolicy: 'strip' as const, recursive: false };
const source = (id: string, format: string, conversions: string[] = [], extract = false): Source => ({ id, name: id, file: new File(['fixture'], id), size: 7, directory: false, inspection: { format, conversions, extract } });

it('groups mixed signature-identified files without advertising unrelated operations', () => {
  const sources = [source('misleading.wav', 'png', ['png', 'jpg']), source('music', 'wav', ['wav', 'mp3']), source('archive', 'zip', [], true), source('document', 'pdf')];
  const groups = capabilityGroups(sources, caps);
  expect(groups.map(group => group.id)).toEqual(['png', 'wav', 'zip', 'pdf']);
  expect(groups[0].choices.map(choice => choice.id)).toContain('convert:png');
  expect(groups[0].choices.some(choice => choice.operation === 'extract')).toBe(false);
  expect(groups[0].choices.map(choice => choice.id)).not.toContain('convert:mp3');
  const plan = planGroupedWorkflow(groups, { png: 'convert:png', wav: 'convert:wav', zip: 'extract:zip', pdf: 'compress:zip' }, settings, caps);
  expect(plan.jobCount).toBe(4);
  expect(plan.fileCount).toBe(4);
  expect(plan.groups.map(group => group.operation)).toEqual(['convert', 'convert', 'extract', 'compress']);
  expect(plan.inputBytes).toBe(28);
});

it('requires explicit group choices and validates loss permissions before planning', () => {
  const groups = capabilityGroups([source('image', 'png', ['png', 'jpg'])], caps);
  expect(planGroupedWorkflow(groups, {}, settings, caps).groups).toEqual([]);
  const refused = planGroupedWorkflow(groups, { png: 'convert:jpg' }, settings, caps);
  expect(refused.groups).toEqual([]);
  expect(refused.issues.join()).toContain('Allow quality loss');
  expect(planGroupedWorkflow(groups, { png: 'convert:jpg' }, { ...settings, qualityMode: 'lossy' }, caps).groups).toHaveLength(1);
});

it('invalidates incompatible saved choices and excludes unreadable files', () => {
  const file = source('image', 'png', ['png']);
  const broken = { ...source('broken', 'png'), inspection: { format: 'unreadable', conversions: [], extract: false, error: 'Read denied' } };
  const groups = capabilityGroups([file, broken], caps);
  expect(groups[1].choices).toEqual([]);
  const plan = planGroupedWorkflow(groups, { png: 'convert:mp3' }, settings, caps);
  expect(plan.groups).toEqual([]);
  expect(plan.skipped).toBe(2);
  expect(plan.issues).toHaveLength(1);
});

it('requires quality-loss consent for the H.264 preset', () => {
  const capability = { ...caps, conversions: ['mp4-h264'] };
  const groups = capabilityGroups([source('movie', 'mkv', ['mp4-h264'])], capability);
  const selected = { mkv: 'convert:mp4-h264' };
  expect(planGroupedWorkflow(groups, selected, settings, capability).issues[0]).toContain('Allow quality loss');
  expect(planGroupedWorkflow(groups, selected, { ...settings, qualityMode: 'lossy' }, capability).groups[0].target).toBe('mp4-h264');
});

it('keeps multi-file archives together and accounts only for bytes still awaiting upload', () => {
  const files = [source('a', 'png', ['png']), { ...source('b', 'png', ['png']), uploaded: 7 }];
  const groups = capabilityGroups(files, caps);
  expect(groups[0].choices.map(choice => choice.id)).not.toContain('compress:gzip');
  const plan = planGroupedWorkflow(groups, { png: 'compress:zip' }, settings, caps);
  expect(plan.jobCount).toBe(1);
  expect(plan.remainingUploadBytes).toBe(7);
  expect(plan.outputLimitPerJob).toBe(2000);
});

it('rejects repeated identities and configured input/file limits without reading contents', () => {
  const file = source('one', 'png', ['png']);
  const group = { id: 'one', sources: [file, file], operation: 'compress' as const, target: 'zip', ...settings };
  expect(() => summarizePlan([group], 0, caps)).toThrow('only once');
  expect(() => summarizePlan([{ ...group, sources: [file] }], 0, { ...caps, limits: { ...caps.limits, input: 1 } })).toThrow('input limit');
  expect(() => summarizePlan([{ ...group, sources: [file] }], 1, { ...caps, limits: { ...caps.limits, files: 1 } })).toThrow('processing limits');
});

it('plans 10000 metadata entries without opening files when the configured limit permits it', () => {
  const files = Array.from({ length: 10000 }, (_, i) => ({ ...source(String(i), 'png', ['png']), file: null, uploaded: 7 }));
  const capability = { ...caps, limits: { ...caps.limits, files: 10000 } };
  const plan = planGroupedWorkflow(capabilityGroups(files, capability), { png: 'convert:png' }, settings, capability);
  expect(plan.fileCount).toBe(10000);
  expect(plan.jobCount).toBe(10000);
  expect(plan.remainingUploadBytes).toBe(0);
});

it('does not confuse an output limit with source size before compression has run', () => {
  const capability = { ...caps, limits: { ...caps.limits, input: 2 * 1024**2, expanded: 512 * 1024 } };
  const file = { ...source('compressible', 'file'), file: null, size: 1024**2, uploaded: 1024**2 };
  const plan = planGroupedWorkflow(capabilityGroups([file], capability), { file: 'compress:zip' }, settings, capability);
  expect(plan.groups).toHaveLength(1);
  expect(plan.outputLimitPerJob).toBeLessThan(plan.inputBytes);
  expect(plan.issues).toEqual([]);
});
