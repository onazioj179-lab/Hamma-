import type { Capability, Source } from './client';

/** Registry hints never replace the worker's signature/codec validation. */
export function resolveActions(sources: Source[], capability: Capability | null) {
  const rows = sources.map(source => source.directory ? undefined : source.inspection || (capability?.inspection ? undefined : capability?.actionRegistry?.find(row =>
    source.file?.type ? row.mime.includes(source.file.type) : row.extensions.includes(source.name.split('.').pop()?.toLowerCase() || ''))));
  const conversions = sources.length ? (capability?.conversions || []).filter(target => rows.every(row => row?.conversions.includes(target))) : [];
  return { conversions, extract: !!sources.length && rows.every(row => row?.extract) };
}


export function resolveArchiveTargets(sources: Source[], capability: Capability | null): string[] {
  return (capability?.archives || ['zip']).filter(format =>
    !capability?.singleFileArchives?.includes(format) || sources.length === 1 && !sources[0].directory);
}
