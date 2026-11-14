import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [address, output, perFile = '65536', fileCount = '5000', mode = 'pause'] = process.argv.slice(2);
if (!address || !output || !process.env.HAMMA_PLAYWRIGHT) {
  throw new Error('Supply loopback URL and report path, and set HAMMA_PLAYWRIGHT to the Playwright package path.');
}
const url = new URL(address);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use a disposable loopback processor.');
const bytesPerFile = Number(perFile);
assert.ok(Number.isInteger(bytesPerFile) && bytesPerFile >= 256 && bytesPerFile <= 384 * 1024);
assert.ok(['pause', 'reload'].includes(mode));
const count = Number(fileCount);
assert.ok(Number.isInteger(count) && count >= 2 && count <= 5000);
const { chromium } = createRequire(import.meta.url)(process.env.HAMMA_PLAYWRIGHT);
const browser = await chromium.launch({ executablePath: process.env.HAMMA_CHROMIUM || undefined });
const staging = await mkdtemp(join(tmpdir(), 'hamma-browser-scale-fixture-'));

function runPython(code, args) {
  const { status, stderr, stdout } = spawnSync('python', ['-c', code, ...args], { encoding: 'utf8' });
  assert.equal(status, 0, stderr);
  return stdout;
}

try {
  const expected = {};
  const paths = [];
  // Tile a deterministic incompressible seed per file and include a unique index.
  const base = Buffer.concat(Array.from({ length: Math.ceil(bytesPerFile / 32) }, (_, i) =>
    createHash('sha256').update('hamma scale seed ' + i).digest())).subarray(0, bytesPerFile);
  for (let index = 0; index < count; index++) {
    const name = 'input-' + String(index).padStart(4, '0') + '.bin';
    const path = join(staging, name);
    const data = index === 0 ? Buffer.alloc(9 * 1024 * 1024) : Buffer.from(base);
    if (index === 0) for (let i = 0; i < data.length; i += base.length) base.copy(data, i);
    else {
      const tag = createHmac('sha256', 'HAMMA fixture v1').update(name).digest();
      for (let i = 0; i <= data.length - tag.length; i += tag.length) {
        for (let j = 0; j < tag.length; j++) data[i + j] ^= tag[j];
      }
    }
    data.writeUInt32LE(index, 0);
    expected[name] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    paths.push(path);
    await writeFile(path, data);
  }
  assert.equal(new Set(Object.values(expected).map(value => value.sha256)).size, count);
  const expectedFile = join(staging, 'expected.json');
  await writeFile(expectedFile, JSON.stringify(expected));

  const bulk = await browser.newPage({ baseURL: url.origin, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const small = await browser.newPage({ baseURL: url.origin, viewport: { width: 390, height: 780 }, acceptDownloads: true });
  const cdp = await bulk.context().newCDPSession(bulk);
  await cdp.send('Performance.enable');
  for (const page of [bulk, small]) {
    page.setDefaultTimeout(120000);
    await page.addInitScript(() => localStorage.setItem('hamma-terms-v1', 'accepted'));
    await page.goto(address);
    const capability = await page.context().request.get('/api/process/capabilities');
    assert.ok(capability.ok(), 'Processor capabilities must be available.');
    assert.equal((await capability.json()).uploadBatch, true, 'Use a batch-reservation candidate.');
    await page.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  }
  let uploadRequests = 0;
  bulk.on('request', req => {
    if (req.method() !== 'PUT' || !/\/api\/process\/uploads\/[a-f0-9]{32}$/.test(req.url())) return;
    uploadRequests++;
    if (uploadRequests % 500 === 0) console.log('Bulk chunks submitted:', uploadRequests);
  });
  const apiErrors = [];
  bulk.on('response', res => {
    if (res.url().includes('/api/process/') && res.status() >= 400) apiErrors.push([res.status(), new URL(res.url()).pathname]);
  });
  let queuedJob;
  bulk.on('response', response => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/process/jobs' && response.ok()) {
      queuedJob = { response, time: performance.now() };
    }
  });
  const started = performance.now();
  let peakJsHeap = 0;
  const timer = setInterval(async () => {
    try {
      const { metrics } = await cdp.send('Performance.getMetrics');
      peakJsHeap = Math.max(peakJsHeap, metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? 0);
    } catch {}
  }, 1000);
  try {
    await bulk.getByLabel('Add files to queue').setInputFiles(paths, { timeout: 180000 });
    await bulk.getByText(new RegExp(count.toLocaleString('en-US') + ' selected')).waitFor();
    const selectedSeconds = (performance.now() - started) / 1000;
    const compress = page => page.getByRole('button', { name: 'Compress', exact: true });
    // Pause after at least one completed chunk, then retry the same selection.
    const firstChunk = bulk.waitForResponse(res => res.request().method() === 'PUT' &&
      /\/uploads\/[a-f0-9]{32}$/.test(res.url()) && res.ok(), { timeout: 180000 });
    await compress(bulk).click();
    const first = await firstChunk;
    const firstUpload = new URL(first.url()).pathname;
    await bulk.getByRole('button', { name: 'Pause upload', exact: true }).evaluate(button => button.click());
    await bulk.getByText('Upload paused. Select an action to resume.', { exact: true }).waitFor();
    const { offset } = await (await bulk.context().request.get(firstUpload)).json();
    assert.ok(offset >= 4 * 1024 * 1024 && offset < expected['input-0000.bin'].bytes, 'Pause must leave a committed partial upload.');
    if (mode === 'reload') {
      await bulk.reload();
      await bulk.getByLabel('Reconnect original files', { exact: true }).setInputFiles(paths);
      await bulk.getByText(new RegExp(count.toLocaleString('en-US') + ' selected')).waitFor();
    }
    const resumedAt = performance.now();
    const resumedChunk = bulk.waitForRequest(req => req.method() === 'PUT' &&
      new URL(req.url()).pathname === firstUpload && Number(req.headers()['upload-offset']) === offset);
    await compress(bulk).click();
    await resumedChunk;
    const smallStarted = performance.now();
    const smallBytes = Buffer.from('Small independent workspace payload');
    await small.getByLabel('Add files to queue').setInputFiles({
      name: 'interactive.txt', mimeType: 'text/plain', buffer: smallBytes,
    });
    await compress(small).click();
    const smallDownload = small.waitForEvent('download');
    await small.getByRole('button', { name: /^Download .+\.zip$/ }).click();
    const smallArchive = await smallDownload;
    const smallHex = runPython('import sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).read("interactive.txt").hex())',
      [await smallArchive.path()]);
    assert.equal(smallHex.trim(), smallBytes.toString('hex'));
    const smallSeconds = (performance.now() - smallStarted) / 1000;
    const chunksWhenSmallCompleted = uploadRequests;
    if (count === 5000) assert.ok(chunksWhenSmallCompleted < count,
      'Interactive ZIP must complete while the bulk transfer is still active.');

    await bulk.getByRole('button', { name: /^Download .+\.zip$/ }).waitFor({ timeout: 1800000 });
    assert.ok(queuedJob, 'An upload batch must create a processor job.');
    const job = await queuedJob.response.json();
    assert.equal(job.fileCount, count);
    const queuedSeconds = (queuedJob.time - resumedAt) / 1000;
    const bulkDownload = bulk.waitForEvent('download', { timeout: 1800000 });
    await bulk.getByRole('button', { name: /^Download .+\.zip$/ }).click({ timeout: 1800000 });
    const archive = await bulkDownload;
    const archivePath = await archive.path();
    const verification = JSON.parse(runPython(
      'import hashlib,json,os,sys,zipfile\narchive,expected=sys.argv[1:]\nwith open(expected) as f: expected=json.load(f)\nwith zipfile.ZipFile(archive) as z:\n assert len(z.namelist())==len(expected) and set(z.namelist())==set(expected)\n for name,item in expected.items():\n  with z.open(name) as member: digest=hashlib.file_digest(member,"sha256").hexdigest()\n  assert digest==item["sha256"] and z.getinfo(name).file_size==item["bytes"],name\nprint(json.dumps({"archiveBytes":os.path.getsize(archive),"verifiedFiles":len(expected),"order":z.namelist()}))',
      [archivePath, expectedFile],
    ));
    let members = 0, pages = 0, cursor = '';
    const { order: names, ...archiveMetrics } = verification;
    if (mode === 'pause') assert.deepEqual(names, Object.keys(expected));
    do {
      const response = await bulk.context().request.get('/api/process/jobs/' + job.id + '/manifest?limit=100&after=' + cursor);
      assert.ok(response.ok(), await response.text());
      const page = await response.json();
      for (const entry of page.files) {
        const name = names[members++];
        assert.equal(entry.name, name);
        assert.equal(entry.sha256, expected[name].sha256);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages <= count);
    assert.equal(members, count);
    const report = {
      revision: process.env.HAMMA_TEST_REVISION || null,
      viewport: '1280x900 bulk, 390x780 interactive',
      browser: 'Chromium ' + browser.version(),
      inputBytes: Object.values(expected).reduce((sum, item) => sum + item.bytes, 0),
      uniqueFiles: count, bytesPerRegularFile: bytesPerFile, resumedOffset: offset, uploadRequests,
      peakChromiumJsHeapBytes: peakJsHeap, selectedSeconds, smallSeconds,
      chunksWhenSmallCompleted, queuedSeconds, elapsedSeconds: (performance.now() - started) / 1000,
      manifestPages: pages, ...archiveMetrics, recoveryMode: mode, apiErrors,
    };
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(report);
  } catch (error) {
    console.error({ uploadRequests, apiErrors: apiErrors.slice(-10) });
    console.error(await bulk.getByRole('alert').allTextContents());
    throw error;
  } finally {
    clearInterval(timer);
  }
} finally {
  await browser.close();
  await rm(staging, { recursive: true, force: true, maxRetries: 3 });
}
