# Architecture audit

The active Windows launcher serves the React/TypeScript workspace from Python's local processor on port 5014. Standard archives and FFmpeg conversions run in background processes. SQLite holds owner-scoped jobs/uploads/settings; signed guest cookies and signed output URLs protect retrieval. Browser SPK compression/restoration uses AdaptiveEngine and temporary Blob URLs; its history metadata is stored separately in Zustand local storage.

Cargo contains core, wasm and backend crates, with optional codecs, encryption, native APIs, catalog and distributed modules. These are separate integration surfaces: their presence does not establish that the active Python workflow uses native WASM, distributed orchestration or encryption at rest. No C++ build manifest was identified in the sampled active paths. Do not replace the working processor with a language rewrite without impact review.

Confirmed issues addressed in the current authorized patch: overwritten browser output URLs, phantom history rows, disconnected browser-file deletion, stale reconnect lists, upload expiry/cancellation, request deadlines, cancellation races, inaccurate progress speed units and startup process-identity/race handling. Browser results remain temporary and memory-backed. Physical phone behavior is not certified.

Dependencies use npm and Cargo lockfiles; web React/Zustand/fflate/Vite and optional FFmpeg host tools. No GitHub Actions workflows directory was found. Vulnerability, license and supply-chain scans remain unexecuted; this audit does not assert absence of vulnerabilities. Legacy native/parser modules require individual review before activation.

Impact assessment: current fixes keep file formats, session boundaries and standard worker scheduling intact. Temporary browser outputs are not persisted and add no third-party transmission. New runtime health and restart preparation expose no filenames; restart preparation is instance-bound, loopback-only and pauses scheduling under the worker lock. The pause automatically expires after 30 seconds if restart fails. No data migration or original-file replacement is introduced.
