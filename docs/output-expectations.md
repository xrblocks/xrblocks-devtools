# Tagged output expectations

Tagged output expectations verify durable application results without image
judging. Add a stable tag to each output that a test must inspect:

```js
object.userData.xrblocksDevtools = {
  tag: 'settings-menu',
};
```

## Capture a fixed frame

Capture one snapshot, then run all fixed-frame expectations against that
snapshot. This prevents later frames from changing the evidence between
expectations.

```ts
const snapshot = await captureOutputSnapshot(session);

expectRenderedTag(snapshot, 'settings-menu', {
  count: 1,
  minScreenCoverage: 0.01,
  unoccluded: true,
});
expectSpecificText(snapshot, 'settings-title', 'Settings');
```

`expectRenderedTag` requires all of these results:

- The expected number of tagged outputs exists.
- Each output has renderable geometry.
- Scene Context reports each output as rendered and in the camera frame.
- Each output has a nonzero projected screen extent.

Set `unoccluded: true` when Scene Context must also report the output as being
in line of sight.

Scene Context is the visibility authority. The scene hierarchy does not decide
whether an output is visible.

Use an ID when a tag identifies more than one output:

```ts
expectSpecificText(
  snapshot,
  {tag: 'item-label', id: selectedLabelId},
  'Selected'
);
```

## Compare before and after

Use two snapshots to verify an action result:

```ts
const before = await captureOutputSnapshot(session);
await session.click(primaryHand);
const after = await captureOutputSnapshot(session);

expectCreatedOrRemoved(before, after, 'settings-menu', {created: 1});
expectTransformChanged(before, after, 'selected-object', {
  positionMeters: 0.01,
});
expectRenderStateChanged(before, after, 'button', ['color', 'emissive']);
```

## Check spatial results

```ts
expectSpatialRelation(snapshot, 'label', 'above', 'button', {
  toleranceMeters: 0.01,
});

expectPathConnects(snapshot, 'measurement-line', {
  start: 'start-anchor',
  end: 'end-anchor',
  toleranceMeters: 0.02,
});

expectSurfaceConformance(snapshot, 'placed-object', {
  surface: {label: 'table'},
  maxDistanceMeters: 0.02,
  maxNormalAngleDegrees: 5,
});
```

`expectSpatialRelation` supports `near`, `aligned`, `above`, `inside`,
`touching`, `non-overlapping`, `symmetric`, and `matched`.

Line, ray, and trail geometry uses its first and last position vertices as path
endpoints. Declare custom endpoints when a renderer does not expose an ordered
position attribute:

```js
wire.userData.xrblocksDevtools = {
  tag: 'measurement-line',
  output: {
    get path() {
      return {
        start: startPoint.toArray(),
        end: endPoint.toArray(),
      };
    },
  },
};
```

Custom text can use the same metadata:

```js
label.userData.xrblocksDevtools = {
  tag: 'status-label',
  output: {
    get text() {
      return currentUserFacingText;
    },
  },
};
```

XR Blocks `UIText` and Scene Context text do not need custom metadata.

## Check several frames

Temporal expectations advance deterministic simulation frames:

```ts
await expectBoundedResult(session, {
  maxFrames: 60,
  durableFrames: 3,
  description: 'result text becomes Complete',
  check: (snapshot) =>
    snapshot.outputs.some(
      (output) => output.tag === 'result' && output.text === 'Complete'
    ),
});
```

Use `expectVisibleFromAnyYaw` to rerun Scene Context in several viewer
directions. The helper restores the camera before it returns:

```ts
await expectVisibleFromAnyYaw(session, 'result', {
  yaws: [0, 90, 180, 270],
});
```

## Check session health

Use one health check near the end of each session test. It rejects browser
console errors, page errors, and failed network requests:

```ts
expectSessionHealthy(session);
```
