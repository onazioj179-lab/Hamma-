# Optimization roadmap

Approved current scope: complete existing picker, file lifecycle, history, recovery and one-click local/LAN startup. Preserve correctness and verify regressions. Do not interpret the 100 candidates as implementation approval.

Gate 1: commit tested authorized fixes and keep current deployment truthful about browser versus server processing.
Gate 2: collect representative throughput, memory/RSS, queue latency and disk-space measurements. No performance-sensitive rewrite without measured bottlenecks.
Gate 3: request approval for a selected candidate with acceptance criteria and rollback strategy before any new indexing product, distributed architecture, encryption migration or glass redesign.
Gate 4: add release CI, dependency advisory checks, native Rust/WASM validation and real-device testing after scope approval. These are proposals, not completed release assurances.
