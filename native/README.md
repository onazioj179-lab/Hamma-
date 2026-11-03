# SHANTE CORE 0.1.0

A real C++20 CPU kernel integrated with HAMMA's existing Python service. This
release adds standard Zstandard compression/decompression; it does not replace
the existing ZIP/TAR/LZMA/media engines or certify the entire master brief.

## Build and verify

Requires Python 3.11+, CMake 3.24+, a C++20 compiler and Ninja (or Visual Studio).
On Windows, from the repository root:

```powershell
./scripts/build-shante.ps1
python -m unittest discover -s processor/tests -v
```

The Windows script downloads through the OS certificate store, verifies the
pinned archive SHA-256 and materializes only regular library/CMake source files.
This avoids dependency test symlinks requiring administrator privileges. It also
works around this machine's MinGW CMake certificate-store failure without
disabling TLS verification. Visual Studio is supported with
`-Generator 'Visual Studio 17 2022'`; its executable is under `build/Release`.

On Linux/macOS:

```sh
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --parallel 2
ctest --test-dir native/build --output-on-failure
python3 -m unittest discover -s processor/tests -v
```

The default dependency is Zstandard 1.5.7 from the official release, locked by
SHA-256 in CMake. A pinned vcpkg manifest is supplied; use its toolchain with
`-DSHANTE_SYSTEM_ZSTD=ON` to select that package instead of FetchContent. The
vcpkg build path has not been executed locally. Sanitizer presets and a GitHub
Actions matrix cover intended Linux/macOS/Windows builds; configured checks are
not passed checks until their results are available.

## Application integration

The service discovers `native/build/shante-core[.exe]`. Set `SHANTE_CORE_BINARY`
to an absolute executable path for packaged or multi-configuration builds.
Restart the processor after deployment. `/api/process/capabilities` advertises
`zstd` only after a successful versioned native probe. The existing frontend
populates its archive picker from that response. A missing executable leaves the
existing formats usable; it produces an explicit error if a retained native job
is retried without its engine.

Standard jobs retain their existing SQLite persistence, owner isolation,
idempotency, progress, cancellation and downloads. Native operations run inside
the existing isolated background workers. Zstandard compression accepts one
file. Existing ZIP/TAR operations continue to support folders and batches.
Extraction detects Zstandard by magic bytes and creates the existing verified
ZIP result. Recursive extraction keeps original members alongside their
contents and shares existing path/count/depth/expansion budgets.

## Native contract and limits

```text
shante-core probe
shante-core inspect INPUT
shante-core compress INPUT OUTPUT INPUT_LIMIT OUTPUT_LIMIT MEMORY WORKERS CANCEL_FILE
shante-core decompress INPUT OUTPUT INPUT_LIMIT OUTPUT_LIMIT MEMORY WORKERS CANCEL_FILE
```

The CLI emits bounded JSON lines on stdout: progress, result, or a stable error
code. No file contents or filesystem paths appear in those events. Codec error
diagnostics go to stderr. Successful results report input/output bytes,
verification and tracked codec allocation peak/outstanding bytes.

- RAII owns file handles, temporary output and codec contexts. Inputs must be
  regular files; symlinks/reparse points are rejected at open. Callers must use a
  trusted output directory; the service supplies its private job directory.
- Output uses an exclusive temporary file, a flush/fsync and exclusive
  publication. Existing outputs are never replaced. Compression decodes and
  byte-compares the new frame before publication. The Python integration also
  checks a separate decoded result against the original SHA-256.
- Codec allocations use a thread-safe capped allocator. The adapter selects a
  16–128 MiB codec cap based on reported memory; CLI caps range 1–512 MiB. This
  cap excludes two 256 KiB streaming buffers, verification buffers, C++/OS
  overhead and filesystem caches. It is not a total-RSS promise.
- Compression uses a 1 MiB window and at most two codec workers; decoding rejects
  windows above 8 MiB. Byte counters are 64-bit; streaming memory does not scale
  with input length. Actual multi-terabyte operation has not been tested.
- Cancellation is checked between bounded blocks, including verification. The
  adapter drains progress continuously, applies service deadlines and removes
  unpublished temporary files after forced child termination. Existing service
  recovery handles interrupted job records; active codec checkpoints do not
  resume within a frame.
- CPU feature detection reports AVX2/AVX-512 availability on x86 and the ARM64
  SIMD baseline. This is capability detection, not a custom SIMD implementation.
  Conservative CPU concurrency falls back to synchronous Zstandard on small or
  unknown-memory devices. `gpuAcceleration` is always false in this release.

## Evidence and outstanding scope

Native contracts exercise empty/Unicode/random inputs, synchronous and
multithreaded round trips, limits, low-memory failure, cancellation before and
during work, corruption, truncation, trailing garbage and 64 deterministic
malformed frames. Windows symlink creation is unavailable in the current user
token; that case is explicitly skipped locally. The allocator must return to
zero outstanding codec bytes after successful calls. This is narrower than a
full sanitizer or process leak certification.

Run `python scripts/benchmark-shante.py` for the synthetic verified-operation
baseline and `python scripts/audit-shante.py` for the pinned Zstandard OSV query.
The audit covers that dependency only. The measured polling-notification
experiment did not improve the three-workload baseline, so the existing bounded
polling adapter was retained. No speedup or best compression ratio is claimed.

GPU kernels, LZ4/Brotli/dictionary/deduplication workflows, active-frame
checkpointing, universal persistent filesystem indexing, distributed workers,
at-rest encryption, authenticated public TLS deployment, battery/thermal
tuning, mobile native packaging and physical-device/multi-terabyte validation
remain future work. Existing responsive UI and FFmpeg conversion are reused;
this change does not add native media encoding or claim hardware-assisted media
conversion.

References: [Zstandard streaming API](https://facebook.github.io/zstd/doc/api_manual_latest.html),
[OSV upstream Git-tag queries](https://google.github.io/osv.dev/post-v1-query/).
