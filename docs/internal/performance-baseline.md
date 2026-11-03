# Performance baseline

No comparable before/after throughput or RSS benchmark was collected in this patch. No speedup or compression-ratio improvement is claimed. The existing processor/benchmark.py can measure a repeatable local archive workload including verification and traced Python allocations; traced allocations are not native/process RSS. Keep environmental details and workload sizes with any future measurements.

Measured test execution is correctness evidence, not a throughput benchmark. Avoid extrapolating tiny fixtures to multi-terabyte workloads or concurrent production capacity.
