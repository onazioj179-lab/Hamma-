# HAMMA release readiness

## Remaining web release acceptance

XLSX-to-PDF remains open. The Linux container's XLSX export failed inside the
processor worker. The rollback restores the previously verified DOCX and PPTX
export path. The XLSX acceptance test must render both worksheets and verify
their cell values in the downloaded PDF with worker isolation enabled.

Use the six areas in the [web backlog](hammer-directive-audit.md) as the
release checklist. Run the checks against the same candidate build and record
the revision, platform, fixture, outcome and skipped cases.

| Area | Candidate acceptance |
| --- | --- |
| Mixed project recovery | Reopen unstarted, partial and completed inputs, resume from the saved offset, and verify exact outputs. Repeat with concurrent projects and a file-only retry. |
| Browser job scale | Verify ordered manifest pages and exact outputs at the supported selection limit. Measure browser, worker and disk use with real payloads and check that an interactive job gets a turn during bulk work. |
| UI and devices | Check every view in both themes, with keyboard navigation, reduced motion, and meaningful empty, running, failed and recovered states. Verify file picking, downloads and recovery on physical phones and foldables. |
| Worker isolation and dependencies | Run worker boundary and owner checks. Confirm the deployed inventory and test worker filesystem isolation on the target platform. |
| Formats and fidelity | Expand independent round trips, decoded-media comparisons, encrypted archive variants and spreadsheet PDF export. |
| Production operations | Rehearse migrations, restore, retention and alerting in the target environment. Multi-node recovery requires the intended compute and storage. |

The Windows candidate passed 112 headless Chromium layout cases across eight
views, seven widths and two themes, and the skip link moved focus to main content
in both themes. Two unstarted selections reopened at 375 px. The loopback restart
drill recovered a verified ZIP, the seven-day retention setting and a partial
upload from its saved byte offset. A one-slot run completed all 11 jobs across
three projects and two owners, verified 33,751,040 input bytes and rejected all
11 cross-owner downloads. Windows native CLI and C ABI contracts passed.

An eight-session Windows HTTP run completed 24 jobs in 22.36 seconds, with
16 exact-byte downloads and eight expected corrupt-input failures. Earlier
runs on the same host hit the request rate limit while memory admission held
the queue and encountered connection resets during upload. With two worker
slots available, a fresh 16-session run completed 48 jobs in 98.32 seconds,
with 32 exact-byte downloads and 16 expected corrupt-input failures.

A Windows 11 run on revision `beeb2cb` independently checked every member of an
indexed TAR.GZ containing 10,000 files and 312.5 MiB of deterministic random
input. Directory discovery, archive creation and internal verification took
626.9 seconds. Independent verification ran outside that interval. Peak traced
Python allocations were 3.42 MiB. The trace excludes SQLite and native
allocations and the OS cache. The benchmark ran the worker in-process and
leaves browser upload scale and whole-process memory unverified.

Reproduce with
`python -m processor.indexed_benchmark --files 10000 --bytes-per-file 32768 --output report.json`.

On Python 3.13 the standard TAR reader avoids retaining a separate TarInfo
cache. New verified outputs commit ordered manifest rows together with the
completed job. The browser reads those rows by cursor, and existing inline
manifests remain readable. The staged 201-file ZIP test checks three manifest
pages against the downloaded archive's order and member digests. The
container smoke checks the same manifest before and after recreation.
Archive creation can still hold per-member verification data in memory.
The legacy full-manifest route serializes rows from a single SQLite snapshot,
spills large responses to a temporary file, and releases the snapshot before
sending the response. The browser continues to request cursor pages. Use the
pre-upgrade snapshot for rollback because earlier versions cannot read the
new manifest rows. Windows bsdtar 3.8.9
verified TAR.ZST in both directions, including nested paths, an empty file,
an empty directory and member SHA-256 checks.

## Web release evidence — 2026-11-12

The release remains open. The [web engineering audit](hammer-directive-audit.md)
defines the six acceptance areas. See the [local test report](../../validation/hamma-operational-readiness.json)
for measured results.

| Area | Evidence | Remaining acceptance |
| --- | --- | --- |
| Mixed project recovery | Chromium, Firefox, and WebKit reopened a project with an unstarted file, a partial upload, and a completed upload. In Chromium, one injected admission rejection left the other TIFF job independent, and a file-only retry completed the rejected job. A Windows HTTP workload reopened 12 mixed batches, resumed from 4 MiB, and verified 28 job downloads across four owners. | Verify recovery on physical devices and exercise per-file retry under sustained mixed-project load. |
| Browser job scale | The 5,000-file staged ZIP used 50 reads of 100 records and restored every file in order. Chromium verified a 205-file archive at 375 px. The workspace bounds folder traversal and can cancel a pending folder drop. The Windows mixed workload processed 214,794,240 input bytes across 12 batches and denied all eight cross-owner requests. | Bound archive-library memory and measure larger payloads and sustained browser workloads. |
| Responsive UI and devices | Chromium, Firefox, and WebKit each passed 112 layouts across eight views, seven widths, and two themes with reduced motion. The skip link moved focus to the main content in all three. Headless WebKit required explicit focus on the link. In Chromium at 375 px, the folder picker fallback preserved a nested path and file bytes. | Verify native Tab order in Safari, plus file picking, touch, fold transitions, and recovery on the physical device matrix. Reproducing the reported image failures requires the original files and phone diagnostics. |
| Worker isolation and dependencies | Linux CI verified the socket filter in workers and their child processes. The Linux processor container passed its HTTP smoke test and published the installed package inventory. CI also publishes source SBOMs for npm and pinned processor components. | Enforce worker filesystem isolation, validate network isolation on the target host, and expand fuzz and system-package advisory coverage. |
| Formats and fidelity | TIFF round-trips 16-bit RGBA pixels and rejects a multipage source. HAMMA and bsdtar verified exact extraction in both directions for ZIP, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, and TAR.ZST. The workspace supports AES-256 ZIP, unencrypted split ZIP, and ZIP archive comments. Poppler renders PDF pages, and the Linux container verifies isolated DOCX and PPTX export. | Expand interoperability fixtures and codec coverage. Verify encrypted split sets, ZipCrypto, member comments, lossless policy, and hardware fallback. Add spreadsheet export and broader Office layout checks. |
| Production operations | The Windows loopback upgrade and snapshot restore preserved a known download. Linux CI verified readiness, service recreation, and restoration into a fresh volume with the original signed download, retention setting, and upload offset. | Rehearse rollback and migration on the target deployment and verify retention, backup restoration, alert delivery, and authorized multi-node recovery. |

For a local rollback drill, finish the test jobs and wait for the worker count
to reach zero. Stop the processor, copy its complete data directory, and keep
the source version and port recorded. Start the candidate against the working
copy and verify health, SQLite integrity, and a known download. Stop it before
restoring the pre-upgrade snapshot to a separate directory. Start the previous
version on the same port with that restored copy and verify the known download
and a new job. Keep the upgraded directory for diagnosis. Use disposable
fixtures for the drill.

The Linux container workflow also rehearses backup restoration. It archives
the stopped service's data volume, validates the archive checksum, and
restores into a fresh Compose volume. The restored SQLite store must pass
`PRAGMA quick_check`. The HTTP checks reuse the original guest cookie and
signed download, compare the paged manifest, check retention and owner
boundaries, and complete the upload from its backed-up offset. The workflow
uses the same application image for the source and restored service.

The workflow also runs the image's readiness probe in a disposable container
with networking disabled. It removes the mounted web entry point, checks for
HTTP 503 with reason `web-build`, restores the entry point, and verifies that
Docker emitted healthy, unhealthy and healthy events in order. Monitoring
notification delivery still needs a test in the target environment.

Reproduce the two-owner worker test with
`python -m processor.scheduler_benchmark --multiple-owners --output report.json`.
The one-slot fixture checks dispatch order, owner boundaries and exact bytes.

With SHANTE installed, run `python -m processor.mixed_workload --output report.json` for
the [four-owner HTTP workload](../../validation/mixed-project-http-windows.json).
It verifies recovery of partial, completed, and unstarted files while ZIP,
TAR.GZ, TAR.ZST and extraction jobs share the scheduler. It checks download
hashes, range responses, exact restored bytes, and cross-owner access.

The processor container workflow publishes `processor-image-inventory` after
the HTTP smoke test. It records the tested image ID, installed Debian packages,
Python version, and the bundled SHANTE and Zstandard versions.

Run the two-way ZIP and TAR interoperability fixtures with
`python -m unittest processor.tests.test_archive_interoperability -v`. The
suite uses bsdtar to check nested paths, long names, empty directories and
byte-for-byte extraction for ZIP, TAR, TAR.GZ, TAR.BZ2, and TAR.XZ. It also
checks selective ZIP extraction and verifies digests from bsdtar archives.
Unix fixtures include a Unicode filename. The Windows fixture uses an ASCII
filename because inbox tar could not round-trip the Unicode name under the
tested Windows code page. When inbox tar lacks the XZ write filter, the fixture
compresses its PAX archive with Python XZ before HAMMA verifies and extracts it.

## Load and retention verification — 2026-11-13

The upload reservation rejects an individual file above the configured
input limit. The browser checks the aggregate size before starting an
archive upload, and the server checks both inline and staged selections
before hashing their payloads. In-flight job admission allows one new
submission per owner. A competing submission receives HTTP 429 with
Retry-After, and replay of a committed request still returns the original job.

On Windows 11 with Python 3.13.14 and SHANTE 0.1.0, the loopback
`processor.mixed_workload` completed 28 jobs across four owners and 24
projects. It resumed 12 uploads, verified 214,794,240 bytes of mixed
batch inputs, confirmed output digests and ranges, and denied all eight
cross-owner checks. The candidate run took 75.44 seconds, and the run on
main at `72b227b` took 76.91 seconds. These single-run times do not establish
a throughput gain.

Regression cases cover an expired folder that remains in use, preservation
of readiness through retention failure and API rate limiting, rejection of
invalid request bodies, and a job retry racing a file deletion. Readiness
continues to check the scheduler heartbeat and configured web build.

## Historical baseline — 2026-11-04

Status: PARTIAL. SHANTE is not production complete.

Verified this increment: directory index unit/real-crash tests; cgroup admission
fixture tests; existing native CTest; current-workspace processor regression;
TypeScript typecheck and production web build. Detailed scale data and caveats
are in large-scale-tests.md and the JSON validation artifacts.

Local build artifacts remain web/dist and native/build/shante-core.exe. Native
build reported no work required, then native_contract passed. No binary or source
was deployed. The new index is a Python runtime component and CLI, not a native
kernel scheduler or a browser upload replacement.

Open acceptance includes processing-scale integration, native runtime breadth,
full media/archive matrix, complete project checkpoint semantics, real large-file
and distributed workloads, hardware fallback matrix, mobile/device QA, secure
public hosting, OS sandboxing and unfinished product capabilities. See
completion-matrix.md and unfinished-work.md. Marking the full directive COMPLETE
or VERIFIED would be inaccurate.

Verification detail: current workspace frontend suite passed 476 tests with 23
skipped; processor suite passed 124 tests with 9 optional skips. Isolated new
index/cgroup/resource suites ran 13 tests: 12 passed and 1 symlink test skipped.
TypeScript typecheck and web production build passed. Native contract 1/1 passed.
Production npm audit reported zero vulnerabilities.

Lint status: FAILED. The existing npm lint command invokes ESLint, but neither
its dependency nor a configuration is present. This is an unresolved repository
check, not a successful lint result. Full native sanitizers and physical device
QA were not performed.
