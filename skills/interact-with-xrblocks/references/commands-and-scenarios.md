# Interact Reference

## Contents

- [Launch](#launch)
- [Evidence](#evidence)
- [Targets and actions](#targets-and-actions)
- [Scenarios](#scenarios)
- [Automated tests](#automated-tests)
- [Recording and cleanup](#recording-and-cleanup)

## Launch

Use the installed local binary without allowing `npx` to download a package:

```bash
npx --no-install xrblocks-devtools interact \
  --app-dir ./app \
  --xrblocks-root /path/to/xrblocks \
  --headed
```

Install the app's dependencies first. `--app-dir` starts the app's installed
Vite when its dependencies or configuration identify it as a Vite project;
browser-ready static apps use a copied workspace. Vite source edits are visible
on reload; reopen the session after a full page reload to restore the harness.
DevTools owns and closes these servers.

Use `--url http://127.0.0.1:5173` instead of `--app-dir` for an existing
server. Use `--embodied-control-import <url-or-specifier>` when that page cannot
resolve the default addon specifier.

Other relevant flags are `--entry`, `--timeout-ms`, `--monitor-audio`,
`--no-realtime`, `--simulator-reach-limit`, `--simulator-navmesh`, and the recording flags described
below. Run `xrblocks-devtools help interact` for the installed interface.
Startup exposes browser errors immediately. A silent SDK-readiness stall fails
after 10 seconds, independently of `--timeout-ms`. Initialize XR Blocks normally;
do not assign its debug/readiness globals.

The prompt is JavaScript. Returned promises are waited automatically:

```js
getSimulatorState();
move({forwardMeters: 0.5});
```

Use top-level `await` when an assignment or a larger expression needs the
resolved value:

```js
const button = await inspect({tag: 'start-button'});
button.worldTransform.position;
```

## Evidence

Use these direct functions:

- `saveScreenshot(path, options?)`: write a camera PNG.
- `saveSetOfMark(path)`: write an annotated image and return its marks.
- `getSceneContext({semanticTree?, visibleObjects?, setOfMark?})`: capture
  selected semantic products.
- `getDevtoolsContext({tags?, state?, spatial?, view?})`: capture declared
  metadata and measurements.
- `getCamera()`, `getHands()`, `getSimulatorState()`: capture user state.
- `inspectScene()`: capture the serializable scene hierarchy.
- `findByTag(tag)`, `inspect(target)`: identify and inspect exact objects.
- `diagnostics()`: read console, page, and failed-request entries.

These direct functions are REPL bindings. In Node.js, use
`session.objects.inspect`, `session.objects.findByTag`, `session.diagnostics`,
and `session.getScreenshot()` for a PNG data URL. `saveScreenshot` is a REPL
file-writing helper, not a Session method. Import assertions and
`captureOutputSnapshot` from `@xrblocks/devtools/test`.

Declared state omits undefined object fields and replaces undefined or empty
array entries with `null`; other values must be finite and cycle-free. Context
arrays join by object ID. See [state and target details](../../../docs/scene-context.md).

Inspect saved PNG files with the host's local image tool. Refresh semantic and
view evidence after state changes.

## Targets and actions

A target is an exact unique context/scene name, world `[x, y, z]` in meters, or
`{tag: 'name'}`. Prefer stable Devtools tags where the application provides
them. Disambiguate duplicate tags with `{tag, id}` from `findByTag(tag)`.
`navigateTo` resolves simulator location names before scene names; list locations
with `getDevtoolsContext({locations: true})`. Output-test helpers interpret plain
strings as tags; actions need `{tag}` for tagged targets.

`reachTo` moves a fingertip and does not aim the ray. `pointTo` aims the ray;
`click` presses/releases selection. Use `rayClick(hand, target)` to position,
aim, and click a ray-selected control. Hold `startSelect` until `endSelect`
when dragging.

```js
navigateTo({tag: 'workbench'});
lookAtTarget('Start Button');
pointTo('right', {tag: 'start-button'});
click('right');
```

Movement functions:

- `move({rightMeters?, upMeters?, forwardMeters?, speedMetersPerSecond?})`:
  default `3 m/s`, range `0.05–20 m/s`.
- `rotate({pitchDegrees?, yawDegrees?, rollDegrees?, speedDegreesPerSecond?})`:
  default `360°/s`, range `5–3600°/s`.
- `moveHand(hand, motion)`: default `2 m/s`, range `0.05–20 m/s`.
- `rotateHand(hand, rotation)`: default `360°/s`, range `5–3600°/s`.
- `reachTo(hand, target, options?)`: default `2 m/s`, range `0.05–20 m/s`.
- `lookAtTarget` and `pointTo`: default `360°/s`, range `5–3600°/s`.

Selection and timing functions:

- `startSelect(hand?)`, `endSelect(hand?)`, `click(hand?, options?)`
- `gesture(hand, pose)`, `setHandPose(hand, rotationsInRadians)`
- `wait(durationMs)`, `stepFrame(frames?)`
- `injectAudio({file})` or `injectAudio({text})`

Use the high-level functions above for ordinary movement. `stepControl` and
`applyControl` accept the compound control shape documented in the installed
Devtools README when viewer and hand changes must happen together. Raw movement
tuples use camera-space -Z for forward; high-level `forwardMeters` performs that
conversion. Joint rotations use radians; body/hand rotation tuples use degrees.

## Scenarios

### Select a control

```js
saveScreenshot('./artifacts/select/01-before.png');
getSceneContext({semanticTree: true, visibleObjects: true});
pointTo('right', 'Start Button');
click('right');
stepFrame(2);
getDevtoolsContext({state: true, view: true});
saveScreenshot('./artifacts/select/02-after.png');
```

### Drag an object

```js
inspect({tag: 'draggable-box'});
reachTo('right', {tag: 'draggable-box'});
startSelect('right');
reachTo('right', {tag: 'delivery-target'});
endSelect('right');
stepFrame(2);
inspect({tag: 'draggable-box'});
saveScreenshot('./artifacts/drag/after.png');
```

### Exercise voice input

Activate the app's listening control first, then call `injectAudio` directly.
It waits for a consumer using the session's `timeoutMs` / CLI `--timeout-ms`
(default 300000 ms), and reports a timeout if none appears. Text injection
needs TinyTTS; use a non-silent
WAV file instead when it is unavailable. WAV limits are 25 MB and 60 seconds;
text is limited to 500 characters. Wait for the app's result after delivery;
a completed injection does not prove recognition or an AI response.

```js
getDevtoolsContext({state: true});
injectAudio({text: 'open inventory'});
stepFrame(2);
getDevtoolsContext({state: true});
saveScreenshot('./artifacts/voice/after.png');
```

## Automated tests

Run an explicit JavaScript or TypeScript test file with
`xrblocks-devtools test ./evaluation.ts --app ./app`. A `.test` suffix is not
required. Import `it`, `it_session`, and assertions from `@xrblocks/devtools/test`.
Use `result.json` to judge success: exit code `0` means a valid evaluation,
not that all tests passed. Check the score and individual results. Test `recording`
creates checkpoint video; it does not automatically save agent trajectories.

## Recording and cleanup

```bash
npx --no-install xrblocks-devtools interact \
  --app-dir ./app \
  --record-video ./artifacts/session.mp4 \
  --record-video-padding-ms 500
```

Use `--record-video-scope scene` to keep continuous motion after scene readiness
or `--record-video-scope full` to keep the complete WebM. Use
`--record-checkpoints` when one frame per action is more useful than continuous
motion.

Finish with `.exit` or Ctrl-D. Verify that the CLI, browser, and any server
started by DevTools have stopped. Leave an existing `--url` server running.
