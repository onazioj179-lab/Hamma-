# SHANTE V4 investigation and initial repairs

This change is an initial repair, not acceptance of the full V4 specification.
The selected repository is the existing HAMMA universal workspace. Existing
C++20 Zstandard integration, upload streaming, SQLite jobs, signed downloads,
folder selection and worker limits are retained.

## Confirmed findings and changes

- The submission loop previously aborted on the first upload/job error. File-specific
  HTTP 400/413/415/422 rejections now retain that file and its reason and allow later
  independent conversion/extraction submissions. Capacity, connection and unknown
  failures pause submission and retain unsubmitted files. Compression remains atomic.
- The conversion selector previously offered every backend output to every selection.
  A backend registry now supplies conservative MIME/extension hints. A single resolver
  intersects targets across selected entries and hides incompatible conversion and
  extraction actions. Missing registries fail closed. This is NOT signature inspection:
  workers still probe bytes/codecs and may reject corrupt or incompatible files.
- Retry details are accessible through compact buttons in the virtualized selection
  list. Previously accepted jobs are removed from the selection and not restarted.
- The integrated native Zstandard engine remains optional and probed; its extraction
  hint is only included when available. Existing SPK restore remains available.

## Executed verification

- Type checking and production build passed.
- Existing processor suite: 93 passed, including actual native integration, worker
  crashes, output integrity, session isolation and resumable uploads.
- New registry tests: 2 passed.
- Focused frontend suites: 30 passed, including a mocked 300-file submission with
  14 file-specific rejections: 300 attempts, 286 accepted, 14 retained with details.
  These are submission results, NOT completed image conversions.
- First full frontend run: 450 passed, 2 failed, 23 skipped. The two failures were
  old unrestricted-action expectations; corrected and passed in the focused rerun.
  Final full rerun: 454 passed, 23 skipped (33 suites passed, 1 skipped).
  A subsequent focused test also verifies retrying only the 14 retained files and
  pausing on queue capacity without attempting later files.
- Real engine batch: 300 sequential jobs on Windows desktop, JPEG/PNG/WebP/GIF/AVIF,
  small and 1920x1080 images, Unicode names and repeated basenames in distinct
  nested directories. 228 passed verification; 72 failed; duration 296.715 seconds.
  All 14 intentionally invalid inputs were rejected (9 by the still-image guard,
  5 by media probing). The remaining 58 failures were valid AVIF inputs rejected
  by the existing image-format allowlist. AVIF conversion remains unavailable.
  Per-file timings/errors/hashes: validation/image-batch-v4.json.
  Peak traced Python allocation: 2,340,464 bytes. This excludes codec processes,
  total RSS and browser memory. No baseline speed comparison was measured.

## Outstanding acceptance work

The original mobile issue is NOT reproduced: no original 300-photo collection,
mobile browser trace, failing device, or device memory/thermal measurements were
available. The real codec run is a desktop engine test, not a mobile/network test.
HEIC was not tested. Duplicate same-path selections remain rejected atomically;
no automatic disambiguation is added. AVIF/HEIC and animated-image conversion,
resize, image optimization and PDF compression remain outside the supported UI.

Still open: signature-driven pre-upload actions and stream-aware video/audio
capabilities, a single combined picker menu, per-category mixed processing,
independent project/session UI and project summaries, batch-level retry/download,
browser restart recovery, codec checkpoints, mobile background guarantees,
physical iPhone/foldable/safe-area audits, measured mobile memory limits,
compression modes, benchmark-driven GPU/SIMD dispatch, encrypted object storage,
account synchronization, distributed scheduling and ten-million-entry manifests.
The current UI still loads retained job metadata; it is not a petabyte-scale UI.
No production-scale, GPU, mobile hardware or whole-V4 acceptance claim is made.
