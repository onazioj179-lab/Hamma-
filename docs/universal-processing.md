# Local universal file workspace

This implementation extends HAMMA's React app with real standard-file operations.
It is a local workstation deployment, **not a completed public SaaS or a claim
that all five phases of the development brief have passed acceptance**. The SPK
browser engine and optional Rust API remain separate.

## Run

Install Node.js 22+, Python 3.11+ (tested with 3.13), and optional FFmpeg and FFprobe
on PATH. No Python packages or AI API keys are required. From the repository:

```sh
npm ci
npm run start:local
```

Open http://127.0.0.1:5010. This builds the UI and starts the service. For
development, run `npm run processor` and `npm run dev` in separate terminals;
open http://localhost:5009. Vite forwards `/api/process` to the processor while
preserving browser Host/Origin checks. The optional Rust API has its own `/api`
proxy. The new service does not expose that API's historical experimental routes.

Options: `python -m processor.server --port 5010 --data <directory> --web web/dist`.
By default only numeric loopback addresses are accepted for `--host`. Explicit
private-network testing is available through `--lan` and named private hosts;
see [the Wi-Fi testing guide](lan-testing.md). Use one service per
data directory; an OS file lock enforces this, including across different ports.
Windows listeners also use exclusive address binding. Stop with Ctrl+C. Keep it running for work to continue after
closing the browser.

On Linux: `docker compose -f compose.local.yml up --build -d`. The supplied
configuration uses host networking for loopback access, an unprivileged user,
a read-only root filesystem, dropped capabilities, resource limits and a durable
volume. The image bundles the SHANTE engine for Zstandard operations and is
intended for local use. Rebuild regularly for codec fixes.

Linux processing jobs require libseccomp 2.5 or later and kernel seccomp
filter support. The image includes the runtime. For a bare Debian or Ubuntu
installation, install `libseccomp2`. The filter denies socket creation and
setup for each spawned worker and its child codecs. The HTTP server remains
reachable. A worker that cannot install the filter fails before reading input.
FFmpeg, FFprobe and SHANTE jobs also require Landlock ABI 3 on Linux, available
from Linux 6.2 when Landlock is enabled. Codec subprocesses can read their
assigned input and system runtime files. Conversion and SHANTE subprocesses
can write within the job output directory. A codec fails to launch when its
filesystem rules cannot be applied. Keep uploaded files and credentials
outside system library directories. The Python worker still accesses the
processor data store to record job state.

## Implemented operations

| Operation | Actual behavior |
| --- | --- |
| Compress | ZIP/ZIP64, TAR, TAR.GZ, TAR.BZ2, TAR.XZ; single-file GZIP, BZIP2, XZ. The native SHANTE engine adds TAR.ZST and single-file Zstandard. |
| Extract | Signature-detected ZIP/ZIP64, TAR, compressed TAR, GZIP, BZIP2, XZ; portable ZIP output. Native Zstandard supports raw frames and named Zstandard TAR archives. |
| Recursive extract | Bounded nesting; original archives kept alongside `archive.contents/` |
| Audio | WAV, FLAC, MP3, AAC, M4A, OGG via FFmpeg; every audio track retained as a separate output; multiple tracks packaged as ZIP |
| Video | Stream-preserving MP4/MKV/WebM remux when codecs fit the container; incompatible streams fail visibly |
| Images | Still-image PNG, WEBP, JPG via FFmpeg; animation frames are never silently discarded |
| Selection | Multiple files, folders, recursive folder drops, Unicode names, collision rejection; empty directories through folder drops |
| Jobs | Two worker processes; independent extraction/conversion jobs; compression consolidates selections |
| Recovery | SQLite manifests; crashed workers become Interrupted; queued jobs resume; retry reuses retained inputs |
| Upload | 4 MiB browser chunks; committed offsets reconciled on retry; immutable after consumption |
| Download | Verified output only; session-bound signed links, one-hour maximum validity, ETags, HEAD, byte ranges |
| History | 500 visible guest records; search/filter/sort, 50-row pagination, export, bulk controls |
| Retention | History: 24h/7d/30d/Never; files: 24h/7d/30d; separate deletion; defaults apply to new jobs |
| UI | Virtual file selection list, bottom navigation, light/dark/system appearance, accessible labels, measured progress |

With the native engine installed, `.tar.zst`, `.tar.zstd`, and `.tzst`
archives support extraction, repacking as ZIP, and TAR integrity reports. The
processor uses a bounded temporary TAR file for native encoding and decoding.
The archive must fit the configured expansion and ratio limits. Files named
`.zst` or `.zstd` restore a single file.

Use **Create password-protected ZIP** to write an AES-256 ZIP, or select an
encrypted archive and choose **Unlock ZIP** to download a regular ZIP. Both
actions run in the browser. Passwords and file contents stay in the browser
during processing. File and folder names remain visible in the encrypted
archive. The browser accepts up to 1,000 entries and 128 MiB of file data.

Any file can be compressed as opaque data. That does **not** mean every format
can be extracted or converted. RAR/7Z, unknown archives, server-side encrypted ZIP extraction,
corruption, incompatible codecs, missing audio and engine failures produce failed
jobs, never fake downloads. Media actions are unavailable without FFmpeg/FFprobe.
The Linux container can export DOCX, XLSX and PPTX files to PDF. Select a single
document and choose **Export as PDF**. The isolated renderer accepts Office
files up to 32 MiB and verifies output PDFs of up to 100 pages. Export uses
LibreOffice layout and installed fonts. Editable content, embedded objects and
macros are outside the PDF export workflow. Video conversion is remuxing, not
transcoding.

WAV preserves sample rate, channel count and decoded-stream precision, including
float PCM. RF64 is enabled when needed. WAV/FLAC cannot recover previously lost
quality. Tests decode WAV/FLAC and compare PCM bytes with the source. Conversion
verifies readable streams and durations; other conversions are not certified
bit-identical. Lossy formats are disclosed in Options.

## Integrity and privacy

- Copies use 1 MiB buffers. Archives are read back and verified against source
  SHA-256 manifests. Extraction reads CRCs, accounts for every entry, and verifies
  its portable ZIP against the extracted SHA-256 manifest. Outputs have a digest.
- Paths reject traversal, absolute/drive/UNC paths, ADS, device names, controls,
  Unicode/case collisions and file/directory conflicts. Extraction never writes
  archive-controlled paths to disk. Links, devices, sparse TARs, oversized TAR
  metadata, split ZIPs and oversized ZIP directories are rejected before allocation.
- Nested expansion shares byte/file/depth budgets. Output writes are bounded on
  Windows and Linux. Linux workers additionally get CPU/address-space/file-size
  limits. FFmpeg uses bounded threads/output, a demuxer allowlist and file/pipe
  protocols. Cancellation stops its worker process tree, including FFmpeg.
- Signed, random, HttpOnly, SameSite=Strict temporary session cookies isolate all
  jobs, uploads and downloads. Mutations require a custom header. Host, Origin
  and Fetch Metadata checks protect against browser CSRF/DNS rebinding. The
  service does not enable permissive CORS. These cookies are not tracking cookies.
- Queue creation accepts idempotency identifiers to prevent duplicate work after
  lost acknowledgements. APIs do not expose internal paths or source contents.
  Logs record action IDs/internal diagnostics, not contents or signed links.
  No AI service or third party receives files. Browser-to-service transfer and
  temporary storage are local plaintext; encryption at rest is not implemented.
- File expiry is enforced at download time. Cleanup runs every 30 seconds while
  the service is running, including after restart. Shared input references protect
  files used by other jobs. Clear history hides completed records; it does not
  delete files. Delete all files cancels jobs and removes hidden outputs and
  abandoned uploads. Unlinking is not guaranteed forensic erasure on SSDs.

## Resource and recovery limits

Defaults: 8 GiB per input; 2 GiB expanded/output bytes per job; 5,000 entries;
8 nested levels; 1,000:1 maximum per ZIP-entry expansion; 30 minutes per worker;
100 pending jobs per session; two active workers; 20 GiB logical storage
reservations. Input bytes, completed outputs and active output budgets count
toward storage admission. Archive staging/metadata require extra physical disk
headroom. Storage-full errors remain visible; free space and retry.

The service admits 2,000 API requests/minute per loopback peer. These are local
safeguards, not distributed quotas or a hard filesystem quota. TAR preflight,
SHA-256 checks and verification add I/O to prioritize integrity. Compression uses
conservative defaults, not a trained AI optimizer or an exhaustive algorithm
search. No size or speed guarantee is made.

Chunk upload resumes while the page keeps the same File handle and upload ID.
There is no cross-browser-restart handle recovery or mid-codec checkpoint.
Pause queue affects waiting jobs; pause upload retains committed bytes. Retry
restarts the failed/interrupted job from its retained source; successful jobs
are not repeated. The browser's session-restore behavior may preserve guest
cookies; otherwise closing the guest session loses access. This is not account
synchronization. Stopping the service stops workers.

The guest history view is bounded/paginated; queries currently filter the bounded
metadata set in process. SQLite indexes owner/kind/date, not distributed metadata.
Responsive CSS supports narrow/foldable widths without hinge APIs. Remote mobile
upload, native packaging and PWA offline installation are not added here. Folder
pickers may omit empty directories; folder drops preserve them when the browser
exposes entries. Browsers may require permission for multiple downloads.

## Acceptance and remaining phases

```sh
npm run typecheck
npm run test:processor
npm run test:web
npm run build
python -m processor.benchmark --size-mib 16
```

Processor tests exercise real archive round trips, Unicode/empty directories,
nested archives, path/link/device rejection, cumulative expansion, allocation
and output limits, corruption, cancellation, chunk offsets, immutable sources,
idempotency, actual worker processes, crash recovery, session isolation, signed
and range downloads, history/search/pagination, expiry, bulk deletion, real media
conversion, all audio tracks and PCM integrity. FFmpeg tests skip explicitly when
its binaries are absent. Browser QA selects a generated file, compresses,
downloads and verifies it byte-for-byte. Existing WASM tests may use JS fallbacks
or mocks; synthetic large-offset tests do not certify physical TB throughput.
No 9 TB+ or larger workload has been validated or advertised.

The included benchmark reports verified output size, elapsed time including
verification, input throughput and peak traced Python allocations (not total
native/process RSS). One 16 MiB local sample measured 29.7 MiB/s for repeated text
and 10.8 MiB/s for random bytes, with 3.3–4.3 MB peak Python allocations. Random
bytes grew slightly. These small workload measurements are not capacity promises.

Phase 1 has real standard archive/media operations subject to the stated format
limits. Phase 2 includes bounded streaming, separate workers, manifests and
resumable transfers; mid-job checkpoints remain open. Phase 3 accounts,
synchronized tiers, MCP scopes/auth/revocation, application encryption and E2EE
remain open. Phase 4 distributed workers, object storage, authenticated TLS
gateways, load balancing and multi-terabyte validation remain open. Phase 5
advanced incremental/dictionary/dedup search, enterprise storage and extreme-scale
datasets remain open. No full phase is represented as accepted without its tests.

Public hosting requires a production gateway, authenticated accounts, Secure
cookies/TLS, shared quotas/rate limits, encrypted storage/key management, malware
scanning and per-worker OS/container isolation. This local HTTP service is not
a multi-tenant security boundary against malicious codecs or privileged local
users. It deliberately refuses public binding.

References: [Python ZIP API](https://docs.python.org/3/library/zipfile.html),
[TAR API](https://docs.python.org/3/library/tarfile.html),
[FFmpeg options/stream mapping](https://ffmpeg.org/ffmpeg.html).
