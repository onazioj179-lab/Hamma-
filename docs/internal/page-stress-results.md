# Page and processing stress results

Executed 2026-11-02 on the local Windows deployment.

## Browser: 100 / 100 scoped cases passed

Seven page states (Workspace, Files & History, Overview, General, Privacy, Storage, About) at seven widths (320, 360, 390, 650, 768, 1024, 1440 CSS pixels) in light and dark appearance: 98 cases. Checked visible headings, horizontal page overflow, horizontally clipped visible controls and unexpected alerts. Additional cases exercised a 1,000-file selection (14 rendered rows) and duplicate rejection preserving all 1,000 selected files. Original System appearance and the normal viewport were restored afterward.

Stress testing found genuine overflow on scrolling 320px pages and in the filter toolbar at the desktop/mobile boundary. Removed the fixed body minimum width and replaced fixed filter-column minimums with auto-fit columns bounded by their container. The entire 100-case matrix was rerun after rebuilding; zero final failures. Recorded cases: validation/page-stress-results.json.

## Processor: 100 / 100 generated jobs passed

Ran scripts/stress-local.py with 100 jobs and eight client threads against localhost:5014. ZIP, GZIP, BZIP2 and XZ outputs covered generated empty and nonempty inputs and Unicode paths. Every case verified reconstructed bytes, SHA-256, resumable chunk offsets, idempotent job creation, byte-range downloads and owner isolation. Only generated guest-session files/history were cleaned up. Runtime was 82.136 seconds; this is stress-run duration, not a throughput guarantee. Raw case results: validation/stress-local-results.json.

## Limits

100/100 refers to these defined stress cases, not implementation of the separate 100 engineering proposals or proof that every possible workload passes. Physical phones, browser download-to-disk confirmation, unbounded input sizes and production-scale workloads are not certified by this run.
