# SHANTE 2027 engineering audit

This audit covers the SHANTE release candidate in draft PR #36. It includes the
reviewed reliability changes and TAR integrity reports from PR #32. The
repository also contains Rust SPK, WASM and Flutter components.
VERIFIED applies to the stated scope. PARTIAL describes an implemented subset.
MISSING denotes a capability without implementation evidence in this scope.
BLOCKED denotes acceptance that requires external infrastructure or credentials.

## Remaining release work

| Work | Acceptance |
| --- | --- |
| Consolidate the release | Review the stalled-upload fix in PR #34 and operator indexed TAR in PR #35. Run the processor, web, native and portable package checks on the resulting release commit. |
| Scale browser jobs and recovery | Connect browser folder discovery to disk-backed manifests. Verify paged input and output lists, concurrent project fairness, per-file retry, and browser restart recovery with real payloads. |
| Complete processing coverage | Exercise archive interoperability, encryption, split/join, and broader codecs. Build PDF and Office conversions with isolated parsers. Check decoded bytes, format fidelity and advertised capabilities. |
| Harden untrusted processing | Enforce per-worker filesystem and network isolation, test the production tenant boundary, and expand advisory, SBOM and fuzz coverage. |
| Ship desktop and validate devices | Add a native desktop shell and signed update flow. Test signed installers and physical mobile and foldable interactions. Signing requires platform identities. |
| Validate production operations | Exercise rollback, migration, retention and monitoring in the target deployment. Distributed acceptance requires authorized compute and object storage. |

| Capability | Status | Implementation and remaining acceptance |
| --- | --- | --- |
| Universal input, folders, contextual actions | PARTIAL | `web/src` workspace and capability registry. Exercise drag/drop, native and fallback folder pickers, and mixed selections on the physical-device matrix. |
| Responsive UI and motion | PARTIAL | Web workspace styles and mobile-web entry. Audit all requested motion patterns, touch targets, keyboard interactions and reduced motion under load. |
| Archive creation and compression planning | PARTIAL | ZIP has Fastest, Balanced, Maximum and sample-based Auto profiles. Other formats, dictionary/solid policies and a shared cross-format planner remain open. |
| Archive extraction and integrity | PARTIAL | `processor/engine.py` emits a verified ZIP. ZIP index allocation is bounded, ambiguous names are rejected, and TAR preflight checks effective PAX sizes and compressed trailers. Add interoperability and malformed corpus coverage for remaining formats. |
| Archive inspection, selection, testing and conversion | PARTIAL | Local ZIP inspection, selective ZIP extraction, integrity reports for ZIP and TAR (including gzip, bzip2 and xz wrappers), and repacking supported inputs as Deflate ZIP are available. Additional integrity-test formats and repack targets remain open. |
| Archive passwords, encryption and repair | PARTIAL | Rust SPK has encryption/recovery modules. The processor rejects password-protected ZIP. Add standard-format interoperability and secret handling tests before exposing those controls. |
| Split/join and archive comments | PARTIAL | ZIP creation and local inspection support archive comments. Split/join, member comments and other formats remain open. |
| Native C++20 and ABI | PARTIAL | `native/` implements Zstandard streaming behind a versioned subprocess protocol and a C ABI v1 shared library. The ABI has a compiled C round-trip test. Other codecs and media remain outside the native ABI. |
| Hardware capabilities and dispatch | PARTIAL | Native CPU flags and resource admission exist. Measure device-specific paths and exercise CPU fallback. GPU, power-aware and NUMA scheduling remain open. |
| Streaming and large payloads | PARTIAL | Native Zstandard, resumable transfers and operator-authorized indexed TAR jobs stream data. Exercise real large payloads, memory pressure and 64-bit offsets end to end. Browser input admission remains array-based. |
| Image, video and audio | PARTIAL | `processor/engine.py`, `media_policy.py` and FFmpeg/ffprobe. Available output encoders and muxers determine the advertised targets. Image and audio conversions check the output codec and stream count. Where a decoded checksum is unavailable, output audio and video streams are decoded through EOF before the worker returns a manifest. Remuxed subtitles are checked for stream count and codec. Hardware encoding, additional formats and broader fidelity validation remain open. |
| PDF and office documents | PARTIAL | The processor reports bounded DOCX, XLSX and PPTX package metadata. PDF operations, document rendering and conversions remain open. |
| Mixed-file processing | PARTIAL | `processor/projects.py` and web recovery. Verify subgroup planning and per-file resume together on the integration branch. |
| Scheduler and durable recovery | PARTIAL | `processor/server.py`, `resources.py`, `worker_limits.py`. Windows Job Objects cap committed memory for each worker tree and reap children on worker exit. POSIX limits remain platform-specific. Exercise fairness under sustained load and mid-codec recovery. |
| History, metadata, retention and indexing | PARTIAL | SQLite in `processor/server.py`, `catalog.py`, and `indexing.py`. Indexed TAR jobs have owner-scoped paged manifests and retain discovery checkpoints for retry. Validate migrations, version history and equivalent browser workflows at workload scale. |
| Authentication, authorization and subscriptions | PARTIAL | `processor/accounts.py`, `oauth.py`, and owner-scoped routes. Validate provider settings, tenant boundaries and plan/entitlement lifecycle. |
| Storage, uploads, downloads and sharing | PARTIAL | Local storage, resumable transfer and range handlers in `processor/server.py` and `ranges.py`. Verify storage exhaustion and interrupted transfers. Scoped cross-user sharing and encrypted vault acceptance remain open. |
| Safe preview and parser isolation | PARTIAL | Signature and media probe paths, worker limits and parser whitelists. Add an isolated preview service, strict per-worker controls and external file/network access tests. |
| Dependency and security engineering | PARTIAL | Pinned Zstandard source, workflow checks and audit scripts. Expand SBOM and advisory coverage across Python, Rust, native and FFmpeg, and continue fuzzing and threat-model validation. |
| APIs and MCP | PARTIAL | Python processor HTTP API and Rust compatibility API. No MCP integration established in this scope. Add versioned contracts and authorization tests before exposing tools. |
| Desktop and mobile packaging | PARTIAL | The portable workspace bundles the built web UI, local processor and native CLI. A native desktop shell, signed update verification, notarization and physical-device support remain open. |
| Runtime and build performance | PARTIAL | CMake/Ninja presets and local benchmark scripts. Record reproducible workload, memory and clean/incremental build measurements before selecting optimizations. |
| Benchmarks against reference tools | PARTIAL | A seeded ZIP comparison measures time through verification and output size against bsdtar or 7-Zip. Broader workload, resource and media measurements remain open. |
| Distributed jobs and object storage | BLOCKED | Single-node processor acceptance is separate. Multi-node validation requires an authorized deployment and object storage. Durable ownership, recovery and tenant isolation are open design work. |
| CI, release and production monitoring | PARTIAL | `.github/workflows/` and `scripts/package-shante.py`. Full platform signing requires signing identities. Validate rollback, migration, monitoring and privacy in the intended environment. |

## ZIP acceptance for this change

- Count actual central-directory records before allocating member objects, even
  when a classic or ZIP64 footer lies about the entry count.
- Exercise ZIP64 with ordinary classic fields, hidden NUL bytes, reserved Windows
  device names, duplicate paths and file/parent conflicts in both entry orders.
- Round-trip Unicode filenames and valid directories and verify output digests.
- Stream nonrecursive ZIP and TAR file members directly into the output ZIP.
  Recursive extraction still stages members for signature detection and traversal.
- Preflight accepts single-disk ZIP64 with a fixed-size end record and requires
  central-directory offsets to match the actual archive layout. ZIP64 extensible
  end records and adjusted offsets for prepended content are outside this policy.
- The index walk is streaming. Python's ZIP parser still materializes bounded
  metadata, and the parent-path index uses memory proportional to the stored
  distinct prefixes. This is not million-entry payload acceptance.

## Native acceptance for this change

- Compare decompression's reported input and output byte counts with the actual
  compressed and restored bytes across empty, Unicode, random and multi-block
  payloads. Both counts come from the stream that was decoded.
- Open POSIX inputs without waiting for a FIFO writer. The native contract
  requires a bounded-time failure for a named pipe and checks that no output
  appears. This case requires a POSIX test host.

## Browser ZIP inspection

- Select one local ZIP and open **Inspect ZIP**. The browser lists filenames,
  declared sizes and encryption flags, with search and 50 entries per page.
- Reads are limited to a roughly 64 KiB tail and a 2 MiB central directory.
  Inspection accepts up to 5,000 records, including single-disk ZIP64 with a
  fixed-size end record and safely representable integers. Split archives are
  excluded. Legacy non-ASCII filename bytes are shown as escapes.
- Inspection sends no request and invokes no member decoder. Directory metadata
  remains unverified against file contents and checksums.
- **Extract selected entries** submits the central-directory indexes to the
  processor. Search and paging preserve the selection. The output ZIP contains
  only selected entries and passes the same size, path and digest checks as
  full extraction. Directory entries select the directory itself.
- **Repack as ZIP** converts a supported single archive or compressed stream
  to a Deflate ZIP, preserving verified member bytes. It uses the extraction
  safety policy and retains top-level archive boundaries.
- ZIP compression profiles use Deflate levels 1, 6 and 9. Auto samples at
  most 64 KiB per file and stores members whose sample saves less than 1%.
  Every profile verifies original bytes after packaging. The job records the
  chosen profile for retries. The selector resets to Balanced on project changes.
- ZIP creation accepts an optional plain-text archive comment of up to 1,024
  printable ASCII characters. The worker verifies the embedded bytes before
  publishing. Local inspection previews up to 4,096 comment bytes and escapes
  bytes outside printable ASCII.
- **Test ZIP integrity** uploads one ZIP to the processor. The job streams
  stored or Deflate members through the existing archive quotas, checks
  decoded size and ZIP CRC, and records SHA-256 digests in a JSON report.
  Password-protected and other compression methods are excluded.

## Video audio extraction

The video conversion picker offers the audio formats supported by the installed
encoders and muxers. The worker probes for audio streams and packages multiple
tracks in a ZIP. The HTTP regression downloads a ZIP with two shorter tracks
from a longer video and checks the archive and member hashes and WAV sample counts.

## H.264 MP4 preset

The workspace offers **MP4 (H.264)** when FFmpeg has the MP4 muxer and the
libx264, AAC and timed-text encoders. The preset requires explicit lossy consent
and encodes even-sized video as 8-bit 4:2:0 at CRF 23 with the medium preset.
It converts audio to AAC and supported text subtitles to MP4 timed text.
Unsupported subtitles fail conversion. The job checks output stream counts,
codecs and duration where available, then decodes audio and video through EOF.
The regular MP4 choice still uses stream copy.

## Portable workspace acceptance

- Build the web and native components, then run
  `python scripts/package-shante.py --workspace`. The package stages licenses
  and checksums and starts a temporary loopback server to test the browser
  entry point and native and archive capabilities.
- Extract the ZIP and run `python run-workspace.py` with Python 3.11 or newer.
  Open `http://127.0.0.1:5010`. Use `--data` for a separate private job store.
  Media conversion requires FFmpeg and FFprobe on PATH.
- Packaging sets a stable strip timestamp. CI compares two archives from the
  same built inputs. This check does not compare clean builds across toolchains.

## Comparative ZIP measurement

Run `python scripts/benchmark-archives.py --bsdtar PATH --report REPORT.json`
with bsdtar, or pass `--seven-zip PATH` for 7-Zip. The harness alternates tool
order and checks the SHA-256 of every restored member. A local 32 MiB, 128-entry
run on Windows 11 and an Intel Core i7-8665U measured medians of 1.65 s for SHANTE
and 1.07 s for bsdtar 3.8.9. Both used Deflate level 6. ZIP sizes were 16,842,006
and 16,848,662 bytes respectively. Timings include verification and are specific
to this fixture and machine.

## Office document metadata

The workspace queues an inspection report for conventional DOCX, XLSX and PPTX
packages. The worker checks the main-part relationship and content type and
counts conventional worksheet or slide parts. It parses only two capped UTF-8
metadata files and rejects DTDs and external main relationships. It does not
render the document, open its contents, or validate layout fidelity.

## TAR acceptance for this change

- **Test TAR integrity** uses the same preflight and member safety checks as
  extraction. It reports observed member SHA-256 digests without writing
  extracted files. A TAR header checksum covers header metadata. Comparing
  member digests with an independent reference is required to authenticate
  original contents.
- A local PAX size override determines the payload boundary used for both
  preflight and extraction. Regression fixtures cover a valid override and
  oversized metadata concealed by a conflicting raw header size.
- Require two zero end blocks, allow bounded zero padding, and read compressed
  streams through the codec trailer. Reject sparse formats, global size
  overrides and chained local metadata. Allow ordinary PAX and GNU long names.
- A zero prefix in a gzip, bzip2 or xz stream is ambiguous. An explicit TAR
  suffix identifies an empty compressed TAR. Standalone compressed streams
  preserve their zero bytes.
- Preflight still reads the archive before extraction. Each metadata header and
  cumulative global metadata is capped at 1 MiB. A run of metadata headers
  before a file is capped at eight, with at most one local header at the end.
  These restrictions define the supported archive profile.

Format references are the [PKWARE ZIP Application Note](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
and [Microsoft Windows file naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).
The TAR reader uses Python's [tarfile module](https://docs.python.org/3/library/tarfile.html).
