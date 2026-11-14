# Remaining work

## Highest to lowest priority

1. **Protect shared capacity.** Exercise per-owner admission under repeated
   submissions, add byte-aware limits for uploads and queued work, and verify
   isolation and fairness under sustained load. Make reuse owner-scoped and
   dependent on verified content. Preserve distinct filenames and independent
   deletion and retention.
2. **Verify large and unique data.** Run 5,000 distinct payloads end to end.
   Measure sustained transfer, memory, disk pressure, recovery and small-job
   latency. Validate large offsets with fixtures before attempting a real
   1 TB transfer in a suitably provisioned environment. Continue bounding
   browser selection memory and ZIP central-directory allocations.
3. **Measure smaller archives.** Compare lossless ZIP, TAR.ZST and solid
   archive approaches on the same repetitive, unique and already-compressed
   corpora. Record restoration hashes, archive size, memory and time. Use
   the original fixture and settings to validate the reported 100 GB result.
4. **Release safety.** Finish worker filesystem isolation, dependency and fuzz
   coverage, physical-device recovery, and production backup and alert drills.
5. **Format and workflow coverage.** Finish the outstanding interoperability,
   spreadsheet export, and workflow items. Track pending pull requests until
   their checks pass and they land.
6. **Broader platform work.** Finish vault and sharing, SDK, distributed
   processing and signed packages when their acceptance inputs are available.

## Browser recovery evidence

The Windows Chromium reload smoke test selected 12 unique files totaling
9,448,448 bytes, paused after committing 4 MiB of the first file, reloaded
the workspace, and reattached the originals in one file-picker action.
It resumed from 4 MiB and verified every downloaded ZIP member and the
manifest page against SHA-256 digests. A second workspace completed a
separate ZIP. This smoke case verifies reload recovery; it does not measure
fairness during a sustained transfer.

Run the browser probe against an isolated loopback processor with the web
build served by that processor. Set HAMMA_PLAYWRIGHT to the installed
Playwright package directory. Set HAMMA_CHROMIUM if using a specific
Chromium executable.

    node scripts/validate-browser-scale.mjs http://127.0.0.1:5154 report.json 1024 12 reload

The optional arguments are bytes per regular file, file count, and recovery
mode. Defaults are 65,536 bytes, 5,000 files, and same-tab pause/resume.
The 5,000-file mode also requires the second workspace to finish while the
first is still uploading. Use a fresh data directory between full runs.
If raising HAMMA_REQUESTS_PER_MINUTE for measurement, record the setting
with the result. The report's browser memory metric is sampled JavaScript
heap and excludes browser native allocations and worker RSS.

[Web release checklist](hammer-directive-audit.md#hamma-web-backlog) ·
[Product backlog](unfinished-work.md) ·
[Completed checks](release-readiness.md)
