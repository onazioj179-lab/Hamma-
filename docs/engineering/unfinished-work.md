# Unfinished work

Status: partial. This list distinguishes work already on main from the
remaining release acceptance work.

1. [Indexed local TAR jobs](local-indexed-jobs.md) already admit and stream
   local directory indexes. Extend disk-backed inputs and output manifests to
   the other workflows; browser row virtualization limits rendering, but the
   selected source metadata is still held in memory.
2. Validate mixed-format processing and per-file retry under sustained load.
   Exercise recovery across batches that include unstarted, interrupted, and
   completed uploads. Verify fairness between large and interactive jobs.
3. Continue validating installed codecs, archive password and selective
   extraction paths, lossless policy, and hardware fallback. Existing
   verified formats do not cover the full matrix.
4. Local ZIP preview and archive comments are implemented. Broader previews,
   safe duplicate-output reuse, an encrypted recovery vault, persistent
   presets, folder change detection, revision history, SDK, and
   scoped temporary sharing remain open.
5. Select and configure authorized storage connectors, compute nodes, and
   object storage before validating distributed coordination and cost.
6. Validate cgroup behavior under live container pressure and Windows hard
   memory and process-tree isolation. Native codec budgets do not cap the
   whole worker.
7. Run real large-payload integrity and throughput tests, storage exhaustion,
   and sustained pressure. The metadata benchmarks do not establish payload
   throughput or a maximum supported workload.
8. Complete security, encryption-at-rest, and public-hosting acceptance and
   physical mobile, foldable, and accessibility QA. The workspace motion
   controls honor the user's reduced-motion preference.
9. Validate HAMMA web rollback, migration, retention, and monitoring in the
   target deployment.
