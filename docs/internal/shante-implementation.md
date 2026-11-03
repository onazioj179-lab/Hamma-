# SHANTE CORE execution record — 2026-11-02

The SHANTE master brief authorizes a new native engine. This is an implemented,
verified initial kernel release, not completion of the whole platform brief.
The existing application remains the integration host.

## Implemented and reused

| Brief area | Current evidence |
| --- | --- |
| C++ kernel | C++20 library and versioned subprocess CLI, RAII, capped codec allocator, 64-bit counters |
| Hardware tuning | CPU cores, available-memory estimate, x86 AVX2/AVX-512 and ARM64 SIMD capability detection; conservative 0–2 codec workers |
| Lossless processing | Real Zstandard 1.5.7 streaming compression/decompression, checksummed frames, byte-comparison verification before exclusive publication, independent Python SHA-256 round trip |
| File discovery | Native bounded signature inspection; existing broader Python detection and recursive ZIP/TAR extraction reused, including nested Zstandard |
| Background jobs | Existing owner-scoped SQLite queue, process isolation, retry, deadlines, cancellation, recovery, metadata and real downloads reused |
| Resource controls | Input/output byte limits, 1 MiB compression window, 8 MiB maximum decoder window, capped native codec allocations, bounded stream buffers and expansion ratio |
| UI and media | Existing capability-driven format picker, responsive UI and FFmpeg pipelines retained; Zstandard advertised only after a valid native probe |
| Dependency/build tooling | Hash-pinned source archive, CMake/Ninja, optional pinned vcpkg manifest, Windows OS-trust-store bootstrap, static analysis and configured CI/sanitizers |
| Release | Installed and stripped Windows CLI, licensed dependency notices, content checksums and a tested ZIP artifact |

The adapter does not inject native code into the HTTP server. A child executable
receives explicit local staging paths and numeric budgets; it emits bounded JSON
events. Cancellation/deadlines propagate through the existing worker boundary.
If the binary is absent, existing codecs remain available and native operations
fail explicitly. No GPU backend or benchmark guarantee is advertised.

## Executed verification

- C++ release build with GCC 15.2 / MinGW x86-64 and CMake 4.1.2 passed.
- Native contract suite: seven tests, six passed and one Windows symlink-creation
  case skipped for unavailable OS privileges. Includes both codec worker modes,
  empty/Unicode/random data, corruption/truncation/trailing data, pre-start and
  in-flight cancellation, original-output preservation, input/output/memory
  limits, 64 deterministic malformed frame cases and zero outstanding tracked
  codec allocations after successful calls.
- Complete processor suite: 52 passed. Includes actual background native jobs,
  HTTP capability discovery and downloads, SHA-256, nested restoration and
  missing-binary fallback to existing formats.
- Production TypeScript/Vite build passed.
- GCC `-fanalyzer` compiled the kernel with warning flags and no diagnostics.
- Packaged CLI passed its probe and the same contract suite with compiler
  directories removed from PATH. The Windows symlink case remains skipped.
- OSV's upstream Git-tag query returned no advisories for Zstandard v1.5.7 at
  the recorded query time. This checks only the pinned native dependency, not
  every runtime/toolchain/web package or the absence of unknown vulnerabilities.

Initial multithreaded tests exposed excessive codec allocation at the original
window/job sizes. Reducing the window and job sizes to 1 MiB and disabling
overlap brought both worker modes within the configured cap; the complete
native suite then passed. No failing test was suppressed.

## Measured baseline

Three repetitions per synthetic 4 MiB workload, including normal verification
and native adapter overhead. Times are medians in seconds on this Windows host.

| Workload | ZIP | gzip | Zstandard | Zstandard output bytes |
| --- | ---: | ---: | ---: | ---: |
| Repeated text | 0.1234 | 0.1159 | 0.3485 | 529 |
| Seeded random | 0.3442 | 0.3000 | 0.2745 | 4,194,413 |
| Mixed | 0.2189 | 0.2002 | 0.2673 | 2,097,411 |

The native route is not consistently faster. It remains an explicit codec
choice. A notification-versus-polling experiment produced no measured benefit;
the polling implementation is retained. Raw baseline and experiment:
`validation/shante-benchmark.json` and `validation/shante-benchmark-after.json`.

## Boundaries and remaining brief requirements

Native CUDA/Metal/Vulkan acceleration and GPU discovery/scheduling, adaptive
algorithm selection, LZ4/Brotli native codecs, dictionaries, deduplication,
incremental archives, active-frame checkpoints/pause-resume, universal filesystem
indexes, distributed processing, encryption/key management, authenticated TLS
hosting, battery/thermal profiles and native mobile packages are not implemented
by this kernel release. Existing host HTTP is not newly certified as encrypted
transport. Existing retained-job metadata is not a universal filesystem index.

Current service limits remain bounded (default 8 GiB input and 2 GiB expanded);
64-bit counters and streaming design do not certify terabyte/petabyte workloads.
Physical iOS/Android/foldable tests, power-loss durability, whole-process leak
tests and sanitizer execution remain unverified locally. Linux/macOS/MSVC and
sanitizer workflows are configured; their remote results must be checked rather
than inferred from the Windows build. The vcpkg alternative was not executed.

MinGW CMake's direct HTTPS fetch failed certificate validation on this host.
The Windows build script uses the OS certificate store, the same pinned SHA-256,
and a regular-file-only source bootstrap. TLS verification stays enabled.

Build/use instructions: `native/README.md`. Release checksums/probe:
`validation/shante-release.json`. Dependency query:
`validation/shante-dependency-audit.json`. Detailed ignored logs are under
`validation/shante-*.log`.
