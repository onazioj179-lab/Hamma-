# Unified workspace validation

## Changes

- One file picker handles standard archive/media jobs and browser SPK compression/restoration.
- History interleaves both engines before search, sort, and pagination. Each operation has a unique ID and a colored format/operation tag. Current SPK downloads attach to their existing history record.
- Overview counts both engines, active/failed work, operation distribution, recent activity, and measured savings from completed compressions only.
- First-use privacy information is inline and nonblocking. Settings and Overview remain available independently of browser engine readiness.
- Windows Start HAMMA.cmd builds changed source, starts the processor in the background, reuses it on subsequent launches, and writes localhost/LAN links. A desktop shortcut was created on the development computer.

## Checks

- Production TypeScript/Vite build passed.
- 28 focused UI/client tests passed across unified activity, Overview, navigation, preferences, upload/retry behavior, and browser compression hooks. The final SPK error/filter change also passed the seven workspace tests.
- All 34 Python processor tests passed, including real worker processes, archive round trips, media conversions, cancellation, isolation, and retention.
- scripts/verify-lan.py passed on the actual private address: four concurrent sessions, four verified ZIP downloads, isolated histories, and cross-session access denied.
- UI at 390 x 844: shared picker, standard ZIP completion, colored operation tags, Overview totals, and browser SPK completion checked. Layout width stayed within the viewport.
- Launcher cold start and subsequent reuse passed on port 5014. Existing LAN data was preserved.

## Remaining verification limits

- A physical iPhone/Android device was unavailable; mobile checks used a narrow browser viewport.
- SPK compression completed through the LAN browser and rendered its current native download link. The in-app browser's download-event wait timed out for blob downloads, so SPK file-save completion was not verified through that UI. Archive and restoration logic is covered by the existing browser tests; do not describe the phone file-save flow as hardware-verified.
- LAN links require the host computer to stay awake, devices on the same reachable network, and the Windows firewall port rule. No public internet hosting was configured.
- Standard jobs belong to a cookie-isolated session. SPK history belongs to browser local storage; this is a unified interface, not cross-device account synchronization.
