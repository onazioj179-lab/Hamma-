import { jsonRequest, type Inspection, type Source } from './client';

function header(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onload = () => { signal.removeEventListener('abort', abort); resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer), value => value.toString(16).padStart(2, '0')).join('')); };
    reader.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('This file could not be read. Select it again.')); };
    reader.onabort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
    reader.readAsArrayBuffer(file.slice(0, 512));
  });
}

/** Sequential 512-byte reads and one bounded metadata request; no full-file decoding. */
export async function inspectSources(sources: Source[], signal: AbortSignal): Promise<Map<string, Inspection>> {
  if (sources.length > 32) throw new Error('Inspection batch limit exceeded');
  const results = new Map<string, Inspection>();
  const readable: { source: Source; head: string }[] = [];
  for (const source of sources) {
    signal.throwIfAborted();
    try { readable.push({ source, head: await header(source.file!, signal) }); }
    catch (error) { if (signal.aborted) throw error; results.set(source.id, { format: 'unreadable', conversions: [], extract: false, error: 'This file could not be read. Select it again.' }); }
  }
  if (readable.length) {
    const response = await jsonRequest<{ entries: Inspection[] }>('/inspect', { entries: readable.map(row => ({ head: row.head })) }, 'POST', { signal });
    if (!Array.isArray(response.entries) || response.entries.length !== readable.length) throw new Error('File inspection failed. Reconnect and retry.');
    response.entries.forEach((entry, index) => {
      if (typeof entry.format !== 'string' || !Array.isArray(entry.conversions) || !entry.conversions.every(value => typeof value === 'string') || typeof entry.extract !== 'boolean') throw new Error('Invalid file inspection response');
      results.set(readable[index].source.id, entry);
    });
  }
  return results;
}
