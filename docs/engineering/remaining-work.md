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

[Web release checklist](hammer-directive-audit.md#hamma-web-backlog) ·
[Product backlog](unfinished-work.md) ·
[Completed checks](release-readiness.md)
