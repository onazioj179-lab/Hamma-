import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCard } from '../components/compression/ResultCard';
import { DropZoneCompact } from '../components/ui/DropZoneCompact';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const result={originalSize:100,compressedSize:20,compressionRatio:0.2,duration:10,averageSpeed:1000,fileName:'restored.txt',downloadUrl:'blob:fixture'};
const downloadButton=()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Download')!;

describe('file controls', () => {
  it('uses exactly one download handler', async () => {
    const onDownload=vi.fn(); const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    await act(async () => root.render(<ResultCard {...result} onDownload={onDownload} />));
    await act(async () => downloadButton().click());
    expect(onDownload).toHaveBeenCalledTimes(1); expect(click).not.toHaveBeenCalled();
  });
  it('preserves restored filenames in fallback downloads', async () => {
    let filename=''; vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){filename=this.download;});
    await act(async () => root.render(<ResultCard {...result} operation="decompress" />));
    await act(async () => downloadButton().click());
    expect(filename).toBe('restored.txt');
    expect(host.textContent).toContain('Restoration Complete'); expect(host.textContent).not.toContain('% saved');
  });
  it('rejects an oversized selection instead of silently omitting files', async () => {
    const onFileSelect=vi.fn(),onFilesSelect=vi.fn();
    await act(async () => root.render(<DropZoneCompact onFileSelect={onFileSelect} onFilesSelect={onFilesSelect} />));
    const input=host.querySelector('input[type=file]')!;
    Object.defineProperty(input,'files',{value:Array.from({length:5001},()=>new File(['a'],'test.txt'))});
    await act(async () => input.dispatchEvent(new Event('change',{bubbles:true})));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('No files were processed');
    expect(onFileSelect).not.toHaveBeenCalled(); expect(onFilesSelect).not.toHaveBeenCalled();
  });
  it('reports callback failures instead of leaving an unhandled rejection', async () => {
    const onFileSelect=vi.fn().mockRejectedValue(new Error('File could not be read'));
    await act(async () => root.render(<DropZoneCompact onFileSelect={onFileSelect} />));
    const input=host.querySelector('input[type=file]')!;
    Object.defineProperty(input,'files',{value:[new File(['a'],'test.txt')]});
    await act(async () => {
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,30));
    });
    expect(host.querySelector('[role=alert]')?.textContent).toBe('File could not be read');
    expect(host.querySelector('button')?.disabled).toBe(false);
  });
  it('does not silently discard files when a batch callback is missing', async () => {
    const onFileSelect=vi.fn();
    await act(async () => root.render(<DropZoneCompact onFileSelect={onFileSelect} />));
    const input=host.querySelector('input[type=file]')!;
    Object.defineProperty(input,'files',{value:[new File(['a'],'one.txt'),new File(['b'],'two.txt')]});
    await act(async () => {
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,30));
    });
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Select one file');
  });

});
