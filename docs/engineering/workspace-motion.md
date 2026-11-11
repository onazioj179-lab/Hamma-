# Workspace motion

Motion should clarify where a control came from, what changed, and where to look next.

- Dropdowns enter from the trigger at 95% scale and ease out over 180 ms. Exits
  reverse toward the trigger over 144 ms. An exiting menu immediately stops
  accepting input and leaves the accessibility tree.
- Buttons scale to 97% as soon as they are pressed and ease back on release.
  Everyday controls use no bounce. Preference knobs ease between positions and
  stretch briefly by 12% as they move.
- Job rows enter in 30 ms steps for the first four rows. The stagger is capped
  so long lists remain responsive. Expanded details reveal through a clip mask.
- Job status icons overlap in the same grid cell and crossfade with a small
  blur. A verified job completion pulses once; failures do not use that cue.
- Reduced motion removes these transitions and animations. Status, labels,
  focus, and selection remain available.
- Curved movement and elastic overscroll are reserved for interfaces with
  draggable objects or direct manipulation. Ordinary clicks and scrolling
  retain their native behavior.
