import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root: `${workspace}/web`, server: { middlewareMode:true }, appType:'custom' });
try {
  const { AdaptiveEngine } = await server.ssrLoadModule('/src/engine/adaptive-engine.ts');
  const directory = new URL('../validation/fixtures/', import.meta.url);
  await mkdir(directory, {recursive:true});
  const text = new TextEncoder().encode('SPK functionality test: preserve every byte.\n'.repeat(100));
  const engine = new AdaptiveEngine({compressionLevel:10});
  const result = await engine.compress(text);
  if (!result.success) throw Error(result.error);
  await writeFile(new URL('roundtrip.txt', directory), text);
  await writeFile(new URL('roundtrip.txt.spk', directory), result.data);
  const files=[{name:'folder/roundtrip.txt',size:text.length,offset:0},{name:'empty.txt',size:0,offset:text.length}];
  const manifest=new TextEncoder().encode(JSON.stringify({version:1,type:'multi-file',fileCount:files.length,files}));
  const container=new Uint8Array(4+manifest.length+text.length);
  new DataView(container.buffer).setUint32(0,manifest.length,true); container.set(manifest,4); container.set(text,4+manifest.length);
  const multi=await engine.compress(container);
  if (!multi.success) throw Error(multi.error);
  await writeFile(new URL('multi.spk',directory),multi.data);
  const corrupt=new Uint8Array(result.data); corrupt[64]^=1;
  await writeFile(new URL('corrupt.spk',directory),corrupt);
  console.log('Created single-file, multi-file, and corrupt archive fixtures.');
} finally { await server.close(); }
