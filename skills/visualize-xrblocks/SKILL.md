---
name: visualize-xrblocks
description: Render and inspect isolated XR Blocks models, public UI roots, or posed simulator hands as PNGs. Use for appearance, layout, framing, materials, or hand-pose review; use interactive sessions for full application behavior.
---

# Visualize XR Blocks

Use a preview as a tight visual loop for one model, UI element, or hand pose. Render a static PNG, inspect the image itself, adjust the source, and repeat.

Read [references/preview-modules.md](references/preview-modules.md) when creating a Preview Module, choosing model/UI/hand options, loading assets, or diagnosing a failed render.

## Visual loop

1. For a model or UI, identify the smallest browser-safe builder and reuse it through a thin Preview Module. For hands, select a named pose and optional joint overrides; no module is needed.
2. Choose `visualize model` for one Three.js object, `visualize ui` for one `UICard` or `UIOverlay`, or `visualize hand` for posed simulator hands. Render to a deliberate artifact path with the view, size, and background needed for the question.
3. Open the generated PNG at full size. Inspect composition, clipping, scale, geometry, materials, text, spacing, contrast, and asset loading as applicable.
4. Change the source or wrapper and render again. Keep the artifact that demonstrates the final result.

Finish only when the latest PNG has been visually inspected and the requested appearance is visible in that artifact.

## Scope boundary

Use this skill when an isolated still image can answer the question. Use `interact-with-xrblocks` when correctness depends on the full app lifecycle, XR Blocks components, controller or voice input, movement, runtime state, visibility changes, or integration between elements.

## Minimal commands

```bash
npx --no-install xrblocks-devtools visualize model ./previews/thing.preview.ts \
  -o ./artifacts/thing.png

npx --no-install xrblocks-devtools visualize ui ./previews/panel.preview.ts \
  -o ./artifacts/panel.png

npx --no-install xrblocks-devtools visualize hand --pose relaxed --hand both \
  --joint index-finger-phalanx-proximal=60,0,0 \
  -o ./artifacts/hands.png
```

Hand CLI joint overrides are in degrees; the JavaScript `rotations` API uses
radians. Hand previews download and cache their models on first use. See the
[hand reference](references/preview-modules.md#hand-previews) for pose names,
axes, cache location, and network requirements.

The visualizer frames returned content automatically. Prefer `inspection-4` for shape review, `turntable-4` for side-by-side rotation, and `front` when one presentation view is the contract.
