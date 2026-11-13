# HAMMA release readiness

## Remaining web release acceptance

Use the six areas in the [web backlog](hammer-directive-audit.md) as the
release checklist. Run the checks against the same candidate build and record
the revision, platform, fixture, outcome and skipped cases.

| Area | Candidate acceptance |
| --- | --- |
| Mixed project recovery | Reopen unstarted, partial and completed inputs, resume from the saved offset, and verify exact outputs. Repeat with concurrent projects and a file-only retry. |
| Browser job scale | Verify ordered manifest pages and exact outputs at the supported selection limit. Measure browser, worker and disk use with real payloads and check that an interactive job gets a turn during bulk work. |
| UI and devices | Check every view in both themes, with keyboard navigation, reduced motion, and meaningful empty, running, failed and recovered states. Verify file picking, downloads and recovery on physical phones and foldables. |
| Worker isolation and dependencies | Run worker boundary and owner checks. Confirm the deployed inventory and test worker filesystem isolation on the target platform. |
| Formats and fidelity | Check advertised archive round trips with independent tools and compare decoded media with source fixtures. Exercise the outstanding encryption, split/join, and document conversion cases. |
| Production operations | Check readiness, retention, interrupted uploads and downloads across service recreation. Rehearse backup restoration, migrations and alerting in the target environment. Multi-node recovery requires the intended compute and storage. |

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

On Python 3.13 the standard TAR reader avoids retaining a separate TarInfo
cache. Output manifests still retain per-member state. Windows bsdtar 3.8.9
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
| Formats and fidelity | TIFF round-trips 16-bit RGBA pixels and rejects a multipage source. HAMMA and bsdtar verified exact extraction in both directions for ZIP, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, and TAR.ZST. TAR.ZST also passed the Linux container create, integrity and extract checks. | Expand interoperability fixtures and cover encryption, split/join, broader codecs, and isolated PDF and Office conversion. |
| Production operations | A disposable Windows loopback upgrade added the dispatch index and passed SQLite quick_check. The guest downloaded the same ZIP after upgrade and snapshot restore. A session-free readiness probe detects a stalled scheduler or missing web build. CI verified the health probe and job execution in the Linux container. | Repeat the drill in the target environment. Verify monitoring alerts, retention, backup restore, and multi-node recovery with authorized infrastructure. |

For a local rollback drill, finish the test jobs and wait for the worker count
to reach zero. Stop the processor, copy its complete data directory, and keep
the source version and port recorded. Start the candidate against the working
copy and verify health, SQLite integrity, and a known download. Stop it before
restoring the pre-upgrade snapshot to a separate directory. Start the previous
version on the same port with that restored copy and verify the known download
and a new job. Keep the upgraded directory for diagnosis. Use disposable
fixtures for the drill.

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
