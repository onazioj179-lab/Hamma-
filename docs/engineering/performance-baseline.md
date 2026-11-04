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
