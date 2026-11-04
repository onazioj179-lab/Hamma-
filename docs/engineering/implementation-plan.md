# Implementation milestones

1. Inspect existing functionality and preserve user changes. COMPLETE.
2. Repair selection loss on duplicate names; add bounded resource admission and
   structured per-job failure records. Implemented; see test-results.md.
3. Verify physical-device failure cases with original input files and diagnostics.
   BLOCKED: original failing files, browser traces and physical devices unavailable.
4. Complete-upload recovery and durable project settings are implemented and
   covered by targeted refresh/isolation/retry tests. Incomplete/unuploaded draft
   recovery, resource-aware planning, grouped mixed operations and independent
   project submission controls remain unfinished. PARTIAL.
5. Finish progressive download packaging, previews, dedup reuse, presets, routes,
   encrypted recovery and revision history in separately tested increments.
6. Add authorized provider connectors, configured cost estimation, sharing and SDK.
7. Validate distributed coordinator only against a measured workload that needs it.
8. Run full acceptance matrix; request owner review before production deployment.

Do not label optional/infrastructure-dependent features as available prematurely.
