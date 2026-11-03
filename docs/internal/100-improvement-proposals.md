# 100 engineering improvement proposals

Status: proposal discovery only. Exactly 100 candidates from the supplied master prompt. None of these entries grants approval for a new product feature or major redesign. Existing authorized bug fixes are recorded separately in completed-work.md.

Scope: evidence-based repository assessment, not certification of every legacy native module. A source file establishes presence, not production readiness. Priorities P1 correctness/security, P2 measured improvement, P3 optional product capability.

## IMP-001 — Automatic compression algorithm selection
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Automatic compression algorithm selection is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: automatic compression algorithm selection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-002 — Content-aware compression
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Content-aware compression is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: content-aware compression acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-003 — Parallel compression workers
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Parallel compression workers is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: parallel compression workers acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-004 — Adaptive compression levels
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Adaptive compression levels is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: adaptive compression levels acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-005 — Streaming compression
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Streaming compression is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: streaming compression acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-006 — Dictionary-based compression
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Dictionary-based compression is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: dictionary-based compression acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-007 — Cross-file deduplication
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Cross-file deduplication is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: cross-file deduplication acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-008 — Block-level deduplication
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Block-level deduplication is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: block-level deduplication acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-009 — Incremental archive updates
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Incremental archive updates is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: incremental archive updates acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-010 — Intelligent compression benchmarking
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `web/src/engine/adaptive-engine.ts`, `core/src/codec.rs`: standard codecs and adaptive browser paths exist; native modules are not evidence of live UI integration.
- Problem: Intelligent compression benchmarking is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: intelligent compression benchmarking acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-011 — Recursive archive discovery
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Recursive archive discovery is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: recursive archive discovery acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-012 — Nested archive extraction
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: nested archive extraction acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-013 — Archive integrity verification
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: archive integrity verification acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-014 — Partial archive recovery where possible
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Partial archive recovery where possible is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: partial archive recovery where possible acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-015 — Password-protected archive handling
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Password-protected archive handling is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: password-protected archive handling acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-016 — Archive bomb detection
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: archive bomb detection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-017 — Safe extraction path validation
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: safe extraction path validation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-018 — Archive format auto-detection
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: archive format auto-detection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-019 — Selective file extraction
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Selective file extraction is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: selective file extraction acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-020 — Streaming archive extraction
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/engine.py`, `processor/tests/test_engine.py`: nested extraction, magic detection, traversal checks and expansion budgets have executable coverage.
- Problem: Streaming archive extraction is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing codec and archive pipeline; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: streaming archive extraction acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-021 — Multi-terabyte streaming support
- Classification: **Future capability**. Priority: **P3**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Multi-terabyte streaming support is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Do not claim multi-terabyte support. Design an opt-in out-of-core architecture and validate large real workloads before enabling it.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: multi-terabyte streaming support acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-022 — 64-bit file offset verification
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: 64-bit file offset verification is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: 64-bit file offset verification acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-023 — Chunk-based file indexing
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Chunk-based file indexing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: chunk-based file indexing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-024 — Resumable large-file uploads
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: resumable large-file uploads acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-025 — Resumable large-file downloads
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: resumable large-file downloads acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-026 — Sparse file handling
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Sparse file handling is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: sparse file handling acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-027 — Memory-mapped I/O where appropriate
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Memory-mapped I/O where appropriate is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: memory-mapped i/o where appropriate acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-028 — Adaptive buffer allocation
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Adaptive buffer allocation is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: adaptive buffer allocation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-029 — Out-of-core processing
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Out-of-core processing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: out-of-core processing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-030 — Distributed large-file manifests
- Classification: **Future capability**. Priority: **P3**.
- Existing comparison / evidence: `web/src/processing/client.ts`, `processor/server.py`, `core/src/massive_pipeline.rs`: chunk uploads and HTTP ranges work; multi-terabyte and out-of-core guarantees are unvalidated.
- Problem: Distributed large-file manifests is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: distributed large-file manifests acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-031 — CPU-aware worker scheduling
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: CPU-aware worker scheduling is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: cpu-aware worker scheduling acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-032 — NUMA-aware processing
- Classification: **Future capability**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: NUMA-aware processing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: numa-aware processing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-033 — SIMD acceleration
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: SIMD acceleration is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: simd acceleration acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-034 — Hardware acceleration detection
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Hardware acceleration detection is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: hardware acceleration detection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-035 — Adaptive concurrency control
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Adaptive concurrency control is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: adaptive concurrency control acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-036 — Backpressure management
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Backpressure management is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: backpressure management acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-037 — Zero-copy transfers where supported
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Zero-copy transfers where supported is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: zero-copy transfers where supported acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-038 — Reduced filesystem syscall overhead
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Reduced filesystem syscall overhead is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: reduced filesystem syscall overhead acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-039 — Efficient asynchronous I/O
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Efficient asynchronous I/O is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: efficient asynchronous i/o acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-040 — Automated performance regression detection
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` runs at most two workers; `core/src/scheduler.rs` and acceleration modules need separate integration and workload evidence.
- Problem: Automated performance regression detection is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: automated performance regression detection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-041 — Bounded memory pools
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Bounded memory pools is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: bounded memory pools acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-042 — Temporary storage lifecycle management
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: temporary storage lifecycle management acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-043 — Disk-space preflight estimation
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Disk-space preflight estimation is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: disk-space preflight estimation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-044 — Storage quota enforcement
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: storage quota enforcement acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-045 — Intelligent temporary file cleanup
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: intelligent temporary file cleanup acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-046 — Content-addressed storage
- Classification: **Requires redesign**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Content-addressed storage is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: content-addressed storage acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-047 — Efficient metadata caching
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Efficient metadata caching is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: efficient metadata caching acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-048 — Crash-safe checkpoint persistence
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Crash-safe checkpoint persistence is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: crash-safe checkpoint persistence acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-049 — Storage fragmentation monitoring
- Classification: **Future capability**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Storage fragmentation monitoring is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: storage fragmentation monitoring acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-050 — Low-memory fallback processing
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` manages quotas, expiry and temporary disk files; browser SPK paths still materialize complete buffers.
- Problem: Low-memory fallback processing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing file IO and job storage; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: low-memory fallback processing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-051 — End-to-end permission auditing
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: End-to-end permission auditing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: end-to-end permission auditing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-052 — Encryption key lifecycle management
- Classification: **Requires redesign**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Encryption key lifecycle management is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: encryption key lifecycle management acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-053 — Secure temporary file handling
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Secure temporary file handling is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: secure temporary file handling acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-054 — Per-user processing isolation
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: per-user processing isolation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-055 — Dependency vulnerability scanning
- Classification: **Missing**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Dependency vulnerability scanning is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Add pinned npm/Cargo advisory checks and a reviewed remediation process; no current vulnerability-free claim is made.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: dependency vulnerability scanning acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-056 — Software supply-chain verification
- Classification: **Missing**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Software supply-chain verification is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: software supply-chain verification acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-057 — Archive traversal protection
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: archive traversal protection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-058 — Privacy-preserving telemetry
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Privacy-preserving telemetry is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep analytics off. Use local aggregate performance counters only if needed and explicitly approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: privacy-preserving telemetry acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-059 — Secure deletion workflow
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Secure deletion workflow is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Define authorized deletion and retention semantics; distinguish unlinking files from guaranteed secure erasure on SSDs.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: secure deletion workflow acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-060 — Automated security regression testing
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` isolates signed guest sessions and checks origins; `core/src/encryption.rs` exists but is not the local processor privacy model.
- Problem: Automated security regression testing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: automated security regression testing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-061 — Centralized API rate limiting
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Centralized API rate limiting is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: centralized api rate limiting acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-062 — Per-user resource quotas
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Per-user resource quotas is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: per-user resource quotas acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-063 — Adaptive request throttling
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Adaptive request throttling is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: adaptive request throttling acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-064 — Idempotent job creation
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: idempotent job creation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-065 — Request deduplication
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: request deduplication acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-066 — API schema validation
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: API schema validation is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: api schema validation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-067 — Structured error responses
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Structured error responses is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: structured error responses acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-068 — API version compatibility
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: API version compatibility is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: api version compatibility acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-069 — Worker health monitoring
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Worker health monitoring is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: worker health monitoring acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-070 — Circuit breakers and retry budgets
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py`, `web/src/processing/client.ts`: idempotency, error responses and retry reconciliation exist; quotas and rate policy remain largely fixed constants.
- Problem: Circuit breakers and retry budgets is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing session/API controls; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: circuit breakers and retry budgets acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-071 — Incremental file indexing
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Incremental file indexing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: incremental file indexing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-072 — Persistent metadata indexes
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: persistent metadata indexes acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-073 — Fast filename search
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Fast filename search is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: fast filename search acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-074 — File signature indexing
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: File signature indexing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: file signature indexing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-075 — Duplicate file detection
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Duplicate file detection is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: duplicate file detection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-076 — Directory tree indexing
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Directory tree indexing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: directory tree indexing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-077 — Virtualized large file listings
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: virtualized large file listings acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-078 — Index corruption recovery
- Classification: **Missing**. Priority: **P1**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Index corruption recovery is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: index corruption recovery acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-079 — Index checkpointing
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Index checkpointing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: index checkpointing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-080 — Efficient file history querying
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/server.py` Store uses SQLite owner/kind/created indexing; shared UI loads all retained records before filtering rather than querying an indexed file catalog.
- Problem: Efficient file history querying is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: efficient file history querying acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-081 — Liquid-glass pill controls
- Classification: **Requires redesign**. Priority: **P3**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Liquid-glass pill controls is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep current accessible solid pills as the fallback. Seek approval for subtle glass on controls only; do not undo current solid-surface decisions during bug fixing.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: liquid-glass pill controls acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-082 — Adaptive glass transparency
- Classification: **Requires redesign**. Priority: **P3**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Adaptive glass transparency is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Prototype feature detection and reduced-transparency fallbacks only after visual approval; measure GPU and contrast impact.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: adaptive glass transparency acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-083 — Reduced-motion accessibility
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: reduced-motion accessibility acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-084 — Mobile-first compact navigation
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: mobile-first compact navigation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-085 — Foldable screen adaptation
- Classification: **Future capability**. Priority: **P3**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Foldable screen adaptation is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: foldable screen adaptation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-086 — Real-time batch progress aggregation
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Real-time batch progress aggregation is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: real-time batch progress aggregation acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-087 — Keyboard-driven bulk selection
- Classification: **Missing**. Priority: **P3**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Keyboard-driven bulk selection is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: keyboard-driven bulk selection acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-088 — Persistent operation queue
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: persistent operation queue acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-089 — Minimal actionable error messages
- Classification: **Existing and working**. Priority: **P2**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: minimal actionable error messages acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-090 — Instant-feeling interface transitions
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `web/src/workspace.css`, `web/src/components/workspace/UniversalWorkspace.tsx`: compact pills, reduced-motion rules, virtualized sources and durable server jobs exist.
- Problem: Instant-feeling interface transitions is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing metadata and frontend state; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: instant-feeling interface transitions acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-091 — Automatic crash recovery
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Automatic crash recovery is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: automatic crash recovery acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-092 — Fault-tolerant job orchestration
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Fault-tolerant job orchestration is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: fault-tolerant job orchestration acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-093 — Per-file completion verification
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: per-file completion verification acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-094 — Deterministic processing manifests
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Deterministic processing manifests is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: deterministic processing manifests acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-095 — Structured performance metrics
- Classification: **Partially implemented**. Priority: **P2**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Structured performance metrics is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: structured performance metrics acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-096 — Distributed worker load balancing
- Classification: **Future capability**. Priority: **P3**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Distributed worker load balancing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Retain local orchestration until measured demand justifies authenticated distributed workers.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: distributed worker load balancing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-097 — Automated integration testing
- Classification: **Existing and working**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Working coverage can regress or be overstated beyond tested limits.
- Proposed solution: Preserve the existing behavior and extend boundary-case regression coverage before changing it.
- Expected benefit: Preserved integrity and clearer capability boundaries.
- Complexity: Low for regression coverage.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Low when limited to additive tests.
- Test requirements: automated integration testing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-098 — Cross-platform compatibility testing
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Cross-platform compatibility testing is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: cross-platform compatibility testing acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-099 — Reproducible release builds
- Classification: **Partially implemented**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Reproducible release builds is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Trace the existing path into the live workspace, measure its limits, then propose a narrowly scoped extension with an explicit resource budget.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: Medium; integrate with the existing processor and browser boundaries.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: reproducible release builds acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.

## IMP-100 — Automated rollback and recovery
- Classification: **Future capability**. Priority: **P1**.
- Existing comparison / evidence: `processor/tests`, `web/src/__tests__`, `scripts/start-hamma.ps1`: integration checks and verified job completion exist; no `.github/workflows` directory was found.
- Problem: Automated rollback and recovery is not fully demonstrated in the active local deployment; existing related code must be checked before adding another subsystem.
- Proposed solution: Keep outside the live application until requirements, threat model, compatibility and rollback strategy are approved.
- Expected benefit: More predictable resource use, reliability or usability within the measured workload; benefit must be validated before release.
- Complexity: High; interface and storage impact assessment required.
- Security implications: Preserve owner isolation, path validation, bounded expansion and private contents; reassess any new storage or network boundary.
- Dependencies: Existing test and release tooling; changes require compatibility review.
- Regression risk: Medium/high until measured and exercised against existing archives, failures and concurrent sessions.
- Test requirements: automated rollback and recovery acceptance case; malformed/empty/boundary inputs; cancellation, failure recovery, isolation and lossless checksum round trips where applicable. Add a before/after benchmark for performance changes.
- Approval: Existing safe bug fixes may proceed; new capabilities and redesign require explicit approval.
