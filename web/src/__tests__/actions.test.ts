import { expect, it } from 'vitest';
import { resolveActions, resolveArchiveTargets } from '../processing/actions';
import type { Capability, Source } from '../processing/client';
const caps: Capability = { version: 1, processing: 'local', archives: ['zip'], conversions: ['png', 'wav'], limits: { input: 1, expanded: 1, files: 5000, seconds: 60 }, actionRegistry: [
  { mime: ['image/png'], extensions: ['png'], conversions: ['png'], extract: false },
  { mime: ['audio/wav'], extensions: ['wav'], conversions: ['wav'], extract: false },
  { mime: ['application/zip'], extensions: ['zip'], conversions: [], extract: true },
] };
const source = (name: string, type = ''): Source => ({ id: name, name, file: new File(['test'], name, { type }), size: 4, directory: false });
it('intersects capabilities and never offers audio for image or mixed selections', () => {
  expect(resolveActions([source('photo.png')], caps)).toEqual({ conversions: ['png'], extract: false });
  expect(resolveActions([source('photo.png'), source('music.wav')], caps).conversions).toEqual([]);
  expect(resolveActions([source('archive.zip')], caps).extract).toBe(true);
});
it('fails closed for missing engines, unknown MIME types, folders and empty selections', () => {
  for (const selected of [[], [source('fake.png', 'application/pdf')], [{ ...source('folder'), directory: true }]]) {
    expect(resolveActions(selected, caps)).toEqual({ conversions: [], extract: false });
  }
  expect(resolveActions([source('photo.png')], null).conversions).toEqual([]);
});


it('uses inspected bytes ahead of misleading names and hides actions while inspection is pending', () => {
  const capability = { ...caps, inspection: true };
  const selected = source('fake.wav', 'audio/wav');
  expect(resolveActions([selected], capability).conversions).toEqual([]);
  selected.inspection = { format: 'png', conversions: ['png'], extract: false };
  expect(resolveActions([selected], capability)).toEqual({ conversions: ['png'], extract: false });
});


it('hides single-file archive formats for folders and multiple selections', () => {
  const capability = { ...caps, archives: ['zip', 'gzip', 'zstd'], singleFileArchives: ['gzip', 'zstd'] };
  expect(resolveArchiveTargets([source('one'), source('two')], capability)).toEqual(['zip']);
  expect(resolveArchiveTargets([{ ...source('folder'), directory: true }], capability)).toEqual(['zip']);
  expect(resolveArchiveTargets([source('one')], capability)).toEqual(['zip', 'gzip', 'zstd']);
});
