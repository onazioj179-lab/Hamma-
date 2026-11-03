# AVIF still-image input repair

The first desktop 300-file run rejected 58 valid AVIF inputs because the
still-image demuxer allowlist excluded their MOV/ISO-BMFF container.

Detection now recognizes the AVIF major file brand from a bounded 512-byte read.
The image policy admits that brand, then retains full FFprobe decoding and
exactly-one-frame validation. Generic MP4 input remains rejected for image
conversion. Existing precision, transparency, output-size and decoded-pixel
verification checks remain in place. The backend registry advertises AVIF input
for existing PNG/WebP/JPEG output targets. No AVIF encoder or HEIC support is added.

Targeted tests: 8 passed, including actual AVIF-to-PNG decoded-pixel equality,
wrong-extension detection, single-frame-video rejection and existing quality guards.
The original batch evidence remains validation/image-batch-v4.json; the rerun is
saved separately as validation/image-batch-avif-fixed.json. These are desktop
engine tests, not physical mobile or memory/RSS certification.

Full processor regression suite: 98 passed.

Rerun result: 300 inputs, 286 verified conversions, 14 deliberately invalid inputs
rejected, 285.866 seconds. All 58 previously rejected valid AVIF inputs completed.
Peak traced Python allocation: 2,343,716 bytes (excludes codec RSS). No speedup
claim is made because run conditions were not controlled for timing comparison.
