# Scale validation â€” 2026-11-04

Status: PARTIAL. Architectural targets are not production capacity claims.

Reproducible commands:

```
python -m processor.index_benchmark --entries 100000 --output validation/index-100000-metadata.json
python -m processor.index_benchmark --entries 1000000 --output validation/index-1000000-metadata.json
python -m processor.index_benchmark --mode directory --entries 10000 --output validation/index-10000-directory.json
```

The metadata mode creates synthetic rows with large logical sizes. It does not
create, read, transfer or process those payloads. Directory mode creates real
29-byte files and measures discovery plus metadata persistence, excluding fixture
creation and cleanup. Peak memory is tracemalloc Python allocations, not process
RSS, SQLite native allocations or filesystem cache.

| Workload | Status | Scope |
| --- | --- | --- |
| 10,000 real files / nested folders | VERIFIED | 10,010 entries including directories; JSON evidence |
| 100,000 logical entries | VERIFIED | Disk persistence and paged reads only |
| 1,000,000 logical entries | VERIFIED | Synthetic rows, disk persistence and paged reads only; 234.630 s insert, 110.904 s paging |
| 10,000,000+ logical entries | NOT STARTED | Must run with disk/time budget; interface has no small diagnostic-count ceiling |
| GB/TB/multi-TB payloads | NOT STARTED | Metadata offset tests do not verify payload processing |
| Worker process exit during indexing | VERIFIED | Actual child exits after commit; replay restores all entries without duplicates |
| Multi-node / object-store / petabyte aggregate | BLOCKED | Infrastructure not configured |

No inference of multi-million-file browser readiness: current UI still collects
selected/recovered source arrays. Index integration and virtualized source views
remain required. Index traversal assumes stable authorized local trees and one
discoverer per database. It is not a distributed filesystem snapshot.


## Indexed processing follow-up - 2026-11-04

Status: PARTIAL. The prior index-to-job gap is now implemented for operator-
authorized TAR-family jobs: bounded discovery and archive manifests, scheduler
integration, indexed manifest pages, storage accounting and checkpoint retention.
See local-indexed-jobs.md for exact scope and validation. Browser source arrays,
ZIP metadata, distributed execution and remaining release requirements are still
open. This update supersedes earlier statements that no processing path consumes
the index; it does not mark the complete platform verified.

Real payload follow-up: VERIFIED for 10,000 files of 4096 deterministic random
bytes each, 10,010 entries including directories, TAR.GZ processing and internal
integrity verification, followed by independent checksums of all extracted
payloads. Total real input: 40,960,000 bytes. See indexed-tar-10000.json and its
before-cache companion. This does not verify larger individual files, a million
real payload files, browser uploads, distributed execution or C++ throughput.
