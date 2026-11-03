import type { Capability, Source } from './client';

/** Registry hints never replace the worker's signature/codec validation. */
export function resolveActions(sources: Source[], capability: Capability | null) {
  const rows = sources.map(source => source.directory ? undefined : capability?.actionRegistry?.find(row =>
    source.file?.type ? row.mime.includes(source.file.type) : row.extensions.includes(source.name.split('.').pop()?.toLowerCase() || '')));
  const conversions = sources.length ? (capability?.conversions || []).filter(target => rows.every(row => row?.conversions.includes(target))) : [];
  return { conversions, extract: !!sources.length && rows.every(row => row?.extract) };
}
