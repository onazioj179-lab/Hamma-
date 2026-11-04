import type { Source } from './client';

const pathKey = (name: string) => name.normalize('NFC').replace(/\\/g, '/').toLowerCase();

/** Preserve every input and basename while allocating safe, distinct archive paths. */
export function allocateSourcePaths(existing: Source[], incoming: Source[]): Source[] {
  const occupied = new Set(existing.map(source => pathKey(source.name)));
  // Reserve original paths first so generated folders cannot displace later inputs.
  const reserved = new Set(incoming.map(source => pathKey(source.name)));
  const files = new Set([...existing, ...incoming].filter(source => !source.directory).map(source => pathKey(source.name)));
  const blockedParent = (name: string) => {
    const parts = pathKey(name).split('/');
    for (let end = 1; end < parts.length; end++) if (files.has(parts.slice(0, end).join('/'))) return true;
    return false;
  };
  const nextCopy = new Map<string, number>();
  return incoming.map(source => {
    let name = source.name;
    if (occupied.has(pathKey(name))) {
      const key = pathKey(source.name);
      let copy = nextCopy.get(key) || 2;
      do { name = `duplicate-${copy++}/${source.name}`; }
      while (reserved.has(pathKey(name)) || occupied.has(pathKey(name)) || blockedParent(name));
      nextCopy.set(key, copy);
    }
    occupied.add(pathKey(name));
    if (!source.directory) files.add(pathKey(name));
    return name === source.name ? source : { ...source, name };
  });
}
