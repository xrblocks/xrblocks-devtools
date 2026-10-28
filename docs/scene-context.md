# Use Scene Context with Embodied Actions

Scene context describes what the application exposes semantically. Devtools
metadata describes stable application-specific targets and state. Use either as
evidence, then pass an exact target to an embodied action.

## Scene context products

```js
await getSceneContext({
  semanticTree: true,
  visibleObjects: true,
  setOfMark: true,
});
```

- `semanticTree` contains the complete semantic hierarchy, live node IDs, and exact names.
- `visibleObjects` contains the current visible semantic nodes, live IDs, and view data.
- `setOfMark` contains an annotated image and marks tied to semantic node IDs.

Calling `saveSetOfMark('./artifacts/marks.png')` writes the image and returns its
metadata. Refresh context after an action because visibility and intersections
can change.

## Developer metadata

Declare metadata on any Three.js object:

```js
startButton.userData.xrblocksDevtools = {
  tag: 'start-button',
  state: {
    enabled: true,
    pressed: false,
  },
};
```

Devtools reads only `userData.xrblocksDevtools`. Getters are evaluated when
context is captured. Undefined object fields are omitted; undefined or empty
array entries become `null`. Other values must be finite, cycle-free JSON data;
functions, symbols, and bigints are rejected with the field path. Getters should
return current values without changing application state.

`inspect(target)` returns `localTransform` and `worldTransform`, each containing
`position`, `quaternion`, and `scale`. In `getDevtoolsContext`, the `tags`,
`state`, `spatial`, and `view` arrays join by object `id`; a state entry does not
repeat the tag.

```js
findByTag('start-button');
inspect({tag: 'start-button'});
getDevtoolsContext({tags: true, state: true, spatial: true, view: true});
```

You can also dynamically spawn objects into the simulator environment with Devtools tags and state. Objects configured with `detectObject: true` and `label` are automatically read into the XR Blocks `objects` module for object detection simulations:

```js
addSimulatorObjects([
  {
    tag: 'target-ball',
    assetPath: './assets/ball.glb',
    detectObject: true,
    label: 'Ball',
    position: [0, 1.2, -1],
    physics: 'dynamic',
  },
]);
```

`spatial` contains world pose and renderable bounds in meters. `view` contains
effective visibility, frustum membership, normalized screen bounds and
coverage, and camera distances in meters.

## Target forms

Embodied actions accept:

```js
pointTo('right', 'ctx_1'); // live ID from the current context snapshot
lookAtTarget('Start Button'); // exact unique context or scene name
navigateTo([0, 1.5, -2]); // world position in meters
pointTo('right', {tag: 'start-button'});
```

A string resolves as a live context ID first, then against names in the newest
context snapshot, then exact scene object names. Duplicate names or tags are
rejected. Refresh context before reusing an ID after an action. A tag is
usually the most stable application contract. To select one of several objects
with the same tag, use `{tag: 'item', id: runtimeId}` with an ID returned by
`findByTag('item')`. Object inspection needs an object target, not coordinates.
`navigateTo` also accepts simulator location names and resolves those before
scene names; list them with `getDevtoolsContext({locations: true})`.

String selectors in test output helpers, such as
`expectVisible(session, 'start-button')`, mean tags. Action strings mean context
IDs or names; pass `{tag: 'start-button'}` to target a tag with an action.

## Choose the action

- `reachTo(hand, target)` moves the fingertip for direct touch or dragging;
  it does not aim the controller ray.
- `pointTo(hand, target)` aims the ray without moving the hand.
- `click(hand)` presses and releases the current selection input.
- `rayClick(hand, target)` positions the hand, aims at the target, and clicks.
- `startSelect` and `endSelect` hold and release selection for dragging.

For a ray-selected control:

```js
rayClick('right', {tag: 'start-button'});
getDevtoolsContext({state: true});
```

An action's completion confirms input delivery; inspect state and visual
output to determine whether the app responded.

## Complete flow

```js
await getDevtoolsContext({state: true, view: true});
lookAtTarget({tag: 'start-button'});
pointTo('right', {tag: 'start-button'});
click('right');
stepFrame(2);
await getDevtoolsContext({state: true, view: true});
saveScreenshot('./artifacts/start-after.png');
```

Compare the declared state and visual evidence. Movement completion alone is
not an application assertion.
