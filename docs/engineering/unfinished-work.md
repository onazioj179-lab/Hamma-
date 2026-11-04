# Unfinished work — 2026-11-04

Status: PARTIAL. These are release gaps, not completed deliverables.

1. Extend the implemented indexed TAR job path to browser-authorized source
   selection and additional formats. Browser input JSON arrays remain unsuitable
   for millions of files. Add disk-backed source pages and UI virtualization.
2. Finish bounded ZIP central-directory handling and remaining extraction/media
   manifests. Indexed TAR manifests are now disk backed and pageable. Resource
   quotas now have explicit operator environment configuration.
3. Finish per-file recovery and compatible mixed-format subgroup execution. Verify
   fair scheduling under sustained concurrent projects and large/interactive jobs.
4. Extend capability detection to the actual installed codecs; verify every
   advertised format, password/selective archive path and lossless policy.
5. Complete previously requested preview, safe duplicate-output reuse, encrypted
   recovery vault, presets, routes, folder change detection, revision history,
   SDK and scoped temporary sharing. Existing widgets are not proof of these.
6. Configure authorized storage connectors, compute nodes and object storage
   before distributed coordination and cost estimation. No credentials assumed.
7. Validate standard and custom Linux cgroup layouts in live containers, Windows
   hard memory/process-tree isolation and pressure behavior. Native codec budgets
   are not whole-worker memory limits.
8. Run larger metadata matrices, real large payload integrity/throughput tests,
   storage exhaustion and sustained memory pressure. No extrapolated TB/PB claims.
9. Perform sanitizer/static-analysis/fuzz/dependency review, public-hosting threat
   model, encryption-at-rest design and physical mobile/foldable/accessibility QA.
10. Produce and validate signed/packaged platform releases after acceptance. A
    successful local web/native build is not a production release.

No artificial small diagnostic scenario is a product requirement. Existing quota
values are resource policy, not demonstrated maximum processing capacity.


## Indexed processing follow-up - 2026-11-04

Status: PARTIAL. The prior index-to-job gap is now implemented for operator-
authorized TAR-family jobs: bounded discovery and archive manifests, scheduler
integration, indexed manifest pages, storage accounting and checkpoint retention.
See local-indexed-jobs.md for exact scope and validation. Browser source arrays,
ZIP metadata, distributed execution and remaining release requirements are still
open. This update supersedes earlier statements that no processing path consumes
the index; it does not mark the complete platform verified.
