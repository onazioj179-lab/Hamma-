# Local performance baseline

Recorded on 2026-11-02 using `python -m processor.benchmark --size-mib 4` on the development Windows host. Both ZIP outputs passed the benchmark integrity verification. Raw measurements: baseline-4mib.json.

| Workload | Input | Output | Seconds including verification | Input MiB/s | Peak traced Python bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| repeated-text | 4194304 | 10351 | 0.5082 | 7.872 | 3254904 |
| random-bytes | 4194304 | 4195712 | 1.8047 | 2.216 | 4240983 |

This is a current baseline, not a before/after comparison or speedup claim. The random input varies between runs; use the recorded checksum to identify this sample. Traced Python allocations exclude native allocations and are not process RSS. Do not extrapolate to large files, phones, distributed workers or production concurrency. No compression algorithm was changed in this batch.
