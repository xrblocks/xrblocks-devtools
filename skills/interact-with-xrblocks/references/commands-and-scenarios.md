# Interact Reference

## Contents

- [Launch](#launch)
- [Evidence](#evidence)
- [Targets and actions](#targets-and-actions)
- [Scenarios](#scenarios)
- [Recording and cleanup](#recording-and-cleanup)

## Launch

Use the installed local binary without allowing `npx` to download a package:

```bash
npx --no-install xrblocks-devtools interact \
  --app-dir ./app \
  --xrblocks-root /path/to/xrblocks \
  --headed
```

Use `--url http://127.0.0.1:5173` instead of `--app-dir` for an existing
server. Use `--embodied-control-import <url-or-specifier>` when that page cannot
resolve the default addon specifier.

Other relevant flags are `--entry`, `--timeout-ms`, `--monitor-audio`,
`--no-realtime`, `--simulator-reach-limit`, `--simulator-navmesh`, and the recording flags described
below. Run `xrblocks-devtools help interact` for the installed interface.

The prompt is JavaScript. Returned promises are waited automatically:

```js
getSimulatorState();
move({forwardMeters: 0.5});
```

Use top-level `await` when an assignment or a larger expression needs the
resolved value:

```js
const button = await inspect({tag: 'start-button'});
button.world.position;
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

Inspect saved PNG files with the host's local image tool. Refresh semantic and
view evidence after state changes.

## Targets and actions

A target is an exact unique context/scene name, world `[x, y, z]` in meters, or
`{tag: 'name'}`. Prefer stable Devtools tags where the application provides
them.

```js
navigateTo({tag: 'workbench'});
lookAtTarget('Start Button');
pointTo('right', {tag: 'start-button'});
click('right');
```

Movement functions:

- `move({rightMeters?, upMeters?, forwardMeters?, speedMetersPerSecond?})`:
  default `1 m/s`, range `0.05–3 m/s`.
- `rotate({pitchDegrees?, yawDegrees?, rollDegrees?, speedDegreesPerSecond?})`:
  default `90°/s`, range `5–180°/s`.
- `moveHand(hand, motion)`: default `0.5 m/s`, range `0.05–1.5 m/s`.
- `rotateHand(hand, rotation)`: default `90°/s`, range `5–180°/s`.
- `reachTo(hand, target, options?)`: default `0.5 m/s`.
- `lookAtTarget` and `pointTo`: default `90°/s`.

Selection and timing functions:

- `startSelect(hand?)`, `endSelect(hand?)`, `click(hand?, options?)`
- `gesture(hand, pose)`, `setHandPose(hand, rotationsInRadians)`
- `wait(durationMs)`, `stepFrame(frames?)`
- `injectAudio({file})` or `injectAudio({text})`

Use the high-level functions above for ordinary movement. `stepControl` and
`applyControl` accept the compound control shape documented in the installed
Devtools README when viewer and hand changes must happen together.

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

```js
getDevtoolsContext({state: true});
injectAudio({text: 'open inventory'});
stepFrame(2);
getDevtoolsContext({state: true});
saveScreenshot('./artifacts/voice/after.png');
```

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

Finish with `.exit` or Ctrl-D. Then verify the interactive CLI and its child
browser/server processes are absent before reporting completion.
