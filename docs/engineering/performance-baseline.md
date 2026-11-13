# Measured local baseline — 2026-11-04

Command: python -m processor.benchmark --size-mib 4

Host: Intel64 Family 6 Model 142 Stepping 12 (GenuineIntel), 8 logical CPUs,
Windows NT 10.0.26300.0. Total physical RAM and GPU were not recorded.

| Workload | Input bytes | Output bytes | Seconds including verification | Input MiB/s | Peak traced Python bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repeated text | 4194304 | 10351 | 0.3415 | 11.712 | 3254904 |
| Random bytes | 4194304 | 4195712 | 0.6198 | 6.454 | 4240987 |

Both ZIP outputs passed the benchmark's integrity verification. Random data varies
between runs. Traced allocations exclude native memory and full process RSS.
This sample ran alongside validation work and is not an isolated performance
comparison, mobile benchmark, codec benchmark or scalability certification.
Hardware characterization and startup/upload/UI/database metrics remain pending.

Selection allocation has a per-path next-copy counter to avoid rescanning all
previous suffixes for thousands of identical names. The 10,000-item test measures
correct allocation only, not real processing capacity.

Real mixed-image desktop run: 300 sequential codec attempts, 286 verified outputs
and 14 deliberate invalid-input failures in 389.017 seconds. Peak traced Python
allocations: 2,342,923 bytes, excluding FFmpeg RSS. This includes fixture generation
and repeated decoder/verification processes, with no before/after comparison.


## Durable discovery increment - 2026-11-04

Status: PARTIAL. No before/after speedup claim. Windows 11 / Python 3.13.14.

| Scope | Insert/discovery seconds | Paged read seconds | Peak traced Python bytes |
| --- | ---: | ---: | ---: |
| 100,000 synthetic metadata entries | 24.311 | 8.324 | 1,006,906 |
| 1,000,000 synthetic metadata entries | 234.630 | 110.904 | 1,007,162 |
| 10,000 real files, 10 directories | 6.469 | 0.583 | 1,370,146 |

JSON reports in validation/index-*.json are authoritative for each run.
Tracemalloc excludes SQLite/native allocations and OS caches. Real discovery
fixtures are 29 bytes each; timings exclude fixture creation and cleanup.
These results do not establish conversion throughput or large-payload capacity.

## Verified 128 MiB ZIP workload — 2026-11-12

The local Windows benchmark used 128 seeded 1 MiB files, evenly split between
repeated text and deterministic random bytes. Each tool ran three times with
ZIP Deflate level 6. All six archives passed size and SHA-256 checks for every
entry. The timed runs include archive creation and integrity verification.

| Tool | Median seconds | Output bytes |
| --- | ---: | ---: |
| HAMMA (SHANTE processor) | 10.96 | 67,311,062 |
| bsdtar 3.8.9 | 10.57 | 67,317,718 |

See the [raw benchmark results](../../validation/zip-128mib-windows.json). This
workload used the local compression engine. Browser uploads, concurrent jobs,
and worker memory were outside the measurement.
