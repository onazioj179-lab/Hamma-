# Feature status

Implementation status and verification are separate. Existing components are not
automatically full acceptance of a feature in the new directive.

| Feature | Status | Evidence or remaining gap |
| --- | --- | --- |
| Adaptive batches / throttling | PARTIAL | Memory/CPU admission and disk preflight; workload calibration pending |
| Per-file error isolation | PARTIAL | Existing independent conversion jobs; archives remain atomic jobs |
| Persistent checkpoints / recovery | PARTIAL | SQLite jobs/upload offsets; browser draft recovery pending |
| Universal input | PARTIAL | Files/folders/drop; duplicate collision selection repaired |
| Smart planner | PARTIAL | Signature hints and action resolver; resource execution plans pending |
| Mixed-file workflows | PARTIAL | Common actions; automatic compatible subgroups pending |
| Capability action resolver | PARTIAL | Existing central registry; codec availability accuracy needs audit |
| Adaptive action dock | PARTIAL | Existing contextual controls; device validation pending |
| Multiple projects | PARTIAL | Separate job IDs/settings drafts; durable empty projects pending |
| Fair scheduling | PARTIAL | Existing project fairness tests; broad starvation/load tests pending |
| Upload/processing overlap | PARTIAL | Independent conversions queue per upload; grouped archives wait |
| Progressive downloads | PARTIAL | Verified individual jobs; bulk browser download behavior unverified |
| Compression preview | NOT STARTED | No validated bounded estimate workflow |
| Duplicate-aware processing | PARTIAL | Catalog identifies duplicates; output reuse pending |
| Smart routes | NOT STARTED | No validated general DAG runner |
| Recovery vault | NOT STARTED | Retained outputs are not an encrypted vault |
| Workflow presets | NOT STARTED | CRUD/capability validation pending |
| Smart Error Center | PARTIAL | Categories, aggregation, eligible retry and dismissal implemented |
| Mini monitor | PARTIAL | Existing job count/events; full aggregate monitor pending |
| Mobile repair | PARTIAL | Wrapping changes; physical device matrix pending |
| Folder change detection | NOT STARTED | Authorized reindex/diff pending |
| Project version history | NOT STARTED | Revision manifests/retention pending |
| Hybrid local/cloud | NOT STARTED | Local server only |
| Storage connectors | NOT STARTED | Requires chosen authorized provider configuration |
| Cost estimator | BLOCKED | No configured infrastructure pricing/billing workflow |
| Distributed coordinator | NOT STARTED | Single-node mode retained; workload justification pending |
| Format capability database | PARTIAL | Signature registry exists; versioned codec verification pending |
| SHANTE SDK | NOT STARTED | Internal client is not a supported external SDK |
| Temporary sharing | NOT STARTED | Owner-bound downloads are not cross-user share links |
| Benchmark lab | PARTIAL | Existing repeatable ZIP benchmark; full matrix pending |
| C++ core | PARTIAL | Existing Zstandard integration; other engines remain separate |

Core release readiness: NOT VERIFIED.
