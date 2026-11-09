# SHANTE 2027 engineering audit

This audit uses the active SHANTE implementation on `codex/shante-reliability`.
The repository also contains Rust SPK, WASM and Flutter components. The older
checkout and separately reviewed branches are outside this branch's test evidence.
VERIFIED applies to the stated scope. PARTIAL describes an implemented subset.
MISSING denotes a capability without implementation evidence in this scope.
BLOCKED denotes acceptance that requires external infrastructure or credentials.

| Capability | Status | Implementation and remaining acceptance |
| --- | --- | --- |
| Universal input, folders, contextual actions | PARTIAL | `web/src` workspace and capability registry. Exercise drag/drop, native and fallback folder pickers, and mixed selections on the physical-device matrix. |
| Responsive UI and motion | PARTIAL | Web workspace styles and mobile-web entry. Audit all requested motion patterns, touch targets, keyboard interactions and reduced motion under load. |
| Archive creation and compression planning | PARTIAL | `processor/engine.py`, `processor/capabilities.py`, Rust SPK codecs. Verify format compatibility, lossless mode and dictionary/solid policies against reference implementations. |
| Archive extraction and integrity | PARTIAL | `processor/engine.py` emits a verified ZIP. ZIP index allocation is bounded, ambiguous names are rejected, and TAR preflight checks effective PAX sizes and compressed trailers. Add interoperability and malformed corpus coverage for remaining formats. |
| Archive inspection, selection, testing and conversion | PARTIAL | Local ZIP inspection, selective ZIP extraction, ZIP integrity checks and repacking supported inputs as Deflate ZIP are available. Additional integrity-test formats and repack targets remain open. |
| Archive passwords, encryption and repair | PARTIAL | Rust SPK has encryption/recovery modules. The processor rejects password-protected ZIP. Add standard-format interoperability and secret handling tests before exposing those controls. |
| Split/join and archive comments | MISSING | Add format-specific support after selecting libraries and validating recovery and metadata behavior. |
| Native C++20 and ABI | PARTIAL | `native/` implements Zstandard streaming behind a versioned subprocess protocol and a C ABI v1 shared library. The ABI has a compiled C round-trip test. Other codecs and media remain outside the native ABI. |
| Hardware capabilities and dispatch | PARTIAL | Native CPU flags and resource admission exist. Measure device-specific paths and exercise CPU fallback. GPU, power-aware and NUMA scheduling remain open. |
| Streaming and large payloads | PARTIAL | Native codec, processor transfers and local indexing are bounded in parts. Exercise real large payloads, cancellation, disk exhaustion, memory pressure and 64-bit offsets end to end. |
| Image, video and audio | PARTIAL | `processor/engine.py`, `media_policy.py` and FFmpeg/ffprobe. Verify advertised codecs and stream policies across installed builds, including metadata, animation, hardware and quality preservation. |
| PDF and office documents | MISSING | Signature recognition exists. Select isolated PDF and office converters, disable active content, and test structure, page counts and fidelity with hostile fixtures. |
| Mixed-file processing | PARTIAL | `processor/projects.py` and web recovery. Verify subgroup planning and per-file resume together on the integration branch. |
| Scheduler and durable recovery | PARTIAL | `processor/server.py`, `resources.py`, `worker_limits.py`. Windows Job Objects cap committed memory for each worker tree and reap children on worker exit. POSIX limits remain platform-specific. Exercise fairness under sustained load and mid-codec recovery. |
| History, metadata, retention and indexing | PARTIAL | SQLite in `processor/server.py`, `catalog.py`, and `indexing.py`. Validate migrations, deletion, version history, query plans and end-to-end paged manifests at workload scale. |
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
- **Test ZIP integrity** uploads one ZIP to the processor. The job streams
  stored or Deflate members through the existing archive quotas, checks
  decoded size and ZIP CRC, and records SHA-256 digests in a JSON report.
  Password-protected and other compression methods are excluded.

## Portable workspace acceptance

- Build the web and native components, then run
  `python scripts/package-shante.py --workspace`. The package stages licenses
  and checksums and starts a temporary loopback server to test the browser
  entry point and native and archive capabilities.
- Extract the ZIP and run `python run-workspace.py` with Python 3.11 or newer.
  Open `http://127.0.0.1:5010`. Use `--data` for a separate private job store.
  Media conversion requires FFmpeg and FFprobe on PATH.

## Comparative ZIP measurement

Run `python scripts/benchmark-archives.py --bsdtar PATH --report REPORT.json`
with bsdtar, or pass `--seven-zip PATH` for 7-Zip. The harness alternates tool
order and checks the SHA-256 of every restored member. A local 32 MiB, 128-entry
run on Windows 11 and an Intel Core i7-8665U measured medians of 1.65 s for SHANTE
and 1.07 s for bsdtar 3.8.9. Both used Deflate level 6. ZIP sizes were 16,842,006
and 16,848,662 bytes respectively. Timings include verification and are specific
to this fixture and machine.

## TAR acceptance for this change

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
