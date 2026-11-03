import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompression } from '../hooks/useCompression';
import { useAppStore } from '../store/app';

const mocks = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable:true, value: vi.fn(() => ({ matches:false, addEventListener:vi.fn(), removeEventListener:vi.fn() })) });
  return { compress: vi.fn(), decompress: vi.fn(), abort: vi.fn(), progress: [] as Array<(progress: Record<string, unknown>) => void> };
});
vi.mock('../engine/adaptive-engine', () => ({ AdaptiveEngine: class {
  onProgress(callback: (progress: Record<string, unknown>) => void) { mocks.progress.push(callback); return this; }
  compress = mocks.compress;
  decompress = mocks.decompress;
  abort = mocks.abort;
} }));
vi.mock('../engine/capability-detector', () => ({ CapabilityDetector: {
  detect: async () => ({ platform: 'desktop', recommendedStrategy:'main-js', hardwareConcurrency:2 }),
} }));

let root: Root;
let host: HTMLDivElement;
let controller: ReturnType<typeof useCompression>;
function Harness() { controller = useCompression(); return null; }
function file(name: string, read: () => Promise<ArrayBuffer>) {
  return Object.assign(new File(['abc'], name), { arrayBuffer: read });
}

beforeEach(async () => {
  vi.clearAllMocks(); mocks.progress.length = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
  useAppStore.getState().resetOperation();
  useAppStore.setState({ sessionOutputs: {}, recentArchives: [] });
  useAppStore.setState({ autoDownload:false });
  mocks.compress.mockResolvedValue({ success:true, data:new Uint8Array([1]), originalSize:3, compressedSize:1, ratio:1/3, duration:1, strategy:'main-js', fallbacksUsed:[] });
  mocks.decompress.mockResolvedValue({ success:true, data:new Uint8Array([97,98,99]) });
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  await act(async () => { root.render(<Harness />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('compression screen workflow', () => {
  it('admits only one job while an earlier file is being read', async () => {
    let finishRead!: (value:ArrayBuffer)=>void;
    const reading = new Promise<ArrayBuffer>(resolve=>{ finishRead=resolve; });
    let first!:Promise<void>;
    await act(async () => { first=controller.compress(file('first.txt',()=>reading)); });
    const secondRead=vi.fn(async()=>new Uint8Array([1]).buffer);
    await act(async () => controller.compress(file('second.txt',secondRead)));
    expect(secondRead).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedFile?.name).toBe('first.txt');
    await act(async () => { finishRead(new Uint8Array([1,2,3]).buffer); await first; });
    expect(mocks.compress).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().operationStatus).toBe('completed');
  });

  it('reports unreadable files instead of making an incomplete multi-file archive', async () => {
    await act(async () => controller.compressMultiple([
      file('good.txt', async () => new Uint8Array([1,2,3]).buffer),
      file('bad.txt', async () => { throw Error('Disk read failed'); }),
    ]));
    expect(useAppStore.getState().operationStatus).toBe('error');
    expect(useAppStore.getState().error).toContain('bad.txt');
    expect(mocks.compress).not.toHaveBeenCalled();
  });
  it('keeps cancellation final when the file read completes later', async () => {
    let finish!: (data: ArrayBuffer) => void;
    const reading = new Promise<ArrayBuffer>(resolve => { finish=resolve; });
    let pending!: Promise<void>;
    await act(async () => { pending=controller.compress(file('slow.txt', () => reading)); });
    await act(async () => controller.cancel());
    await act(async () => { finish(new Uint8Array([1,2,3]).buffer); await pending; });
    expect(mocks.compress).not.toHaveBeenCalled();
    expect(useAppStore.getState().result).toBeNull();
    expect(useAppStore.getState().operationStatus).toBe('idle');
  });
  it('restores files with their original extension', async () => {
    await act(async () => controller.decompress(file('report.txt.spk', async () => new Uint8Array([1,2,3]).buffer)));
    expect(useAppStore.getState().result?.outputName).toBe('report.txt');
    expect(useAppStore.getState().operationType).toBe('decompress');
  });
  it('rejects duplicate paths before compression starts', async () => {
    await act(async () => controller.compressMultiple([file('same', async () => new ArrayBuffer(0)),file('same', async () => new ArrayBuffer(0))]));
    expect(useAppStore.getState().error).toContain('Duplicate');
    expect(mocks.compress).not.toHaveBeenCalled();
  });
});

it('keeps every completed output available through subsequent jobs and reset', async () => {
  vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  await act(async () => controller.compress(file('one.txt', async () => new Uint8Array([1]).buffer)));
  const firstId = useAppStore.getState().result!.historyId!;
  await act(async () => controller.compress(file('two.txt', async () => new Uint8Array([2]).buffer)));
  const secondId = useAppStore.getState().result!.historyId!;
  await act(async () => controller.reset());
  expect(useAppStore.getState().sessionOutputs[firstId].downloadUrl).toBe('blob:first');
  expect(useAppStore.getState().sessionOutputs[secondId].downloadUrl).toBe('blob:second');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => useAppStore.getState().deleteSessionOutput(firstId));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  expect(useAppStore.getState().sessionOutputs[secondId].downloadUrl).toBe('blob:second');
  expect(useAppStore.getState().recentArchives.some(entry => entry.id === firstId)).toBe(true);
});

it('ignores progress from an aborted engine after another job starts', async () => {
  let firstRead!: (value: ArrayBuffer) => void;
  let secondRead!: (value: ArrayBuffer) => void;
  let first!: Promise<void>; let second!: Promise<void>;
  await act(async () => { first = controller.compress(file('first.txt', () => new Promise(resolve => { firstRead = resolve; }))); });
  const oldProgress = mocks.progress[0];
  await act(async () => controller.cancel());
  await act(async () => { second = controller.compress(file('second.txt', () => new Promise(resolve => { secondRead = resolve; }))); });
  await act(async () => oldProgress({ bytesProcessed: 999, totalBytes: 999, phase: 'old progress', speed: 1, eta: 0, strategy: 'main-js' }));
  expect(useAppStore.getState().progress.bytesProcessed).toBe(0);
  expect(useAppStore.getState().selectedFile?.name).toBe('second.txt');
  await act(async () => { controller.cancel(); firstRead(new ArrayBuffer(0)); secondRead(new ArrayBuffer(0)); await Promise.all([first, second]); });
  expect(useAppStore.getState().operationStatus).toBe('idle');
});
it('keeps cancellation final during the yield after the last batch file is read', async () => {
  vi.useFakeTimers();
  try {
    let pending!: Promise<void>;
    await act(async () => { pending = controller.compressMultiple([file('first', async () => new ArrayBuffer(0)), file('second', async () => new ArrayBuffer(0))]); });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => controller.cancel());
    await act(async () => { await vi.advanceTimersByTimeAsync(5); await pending; });
    expect(useAppStore.getState().operationStatus).toBe('idle');
    expect(mocks.compress).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
