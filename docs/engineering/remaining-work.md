# Remaining work

The directive remains PARTIAL. Consult feature-status.md for every feature.

P0: reproduce original 14 mobile failures with real files; validate 10/50/100/300/
1000 images and supported large batches; calibrate memory admission with real
codec peaks; recovery of incomplete/unuploaded selections after tab termination;
broader project checkpoint failure/restart testing;
verify progress and download behavior on the device matrix.

P1: full processing planner, compatible mixed-file groups, independent concurrent
browser submission per project, load-tested fairness, complete pipelined
uploads and reliable progressive bulk download packaging.

P2/P3: remaining previews, safe output reuse, encrypted vault, monitor, presets,
routes, folder diff, revisions, privacy-aware hybrid processing, scoped connectors,
real-pricing estimator, justified coordinator, SDK and secure sharing.

Validation: sanitizer/fuzz execution, accessibility, physical mobile/foldable
testing, cloud infrastructure tests, comprehensive hardware/performance metrics
and production release checks. Optional OAuth dependency tests were skipped in
the baseline. No deployment is authorized without the required final approval.
