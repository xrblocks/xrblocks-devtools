# Tagged output expectations

Tagged output expectations verify application results without image judging.
Add a stable tag to each output that a test must inspect:

```js
object.userData.xrblocksDevtools = {
  tag: 'settings-menu',
};
```

## Check visibility

Use the session directly for visibility checks:

```ts
await expectVisible(session, 'settings-menu');
await expectNotVisible(session, 'loading-indicator');
```

Both helpers use the same visibility result. `expectVisible` passes when the
tagged output has displayed geometry. `expectNotVisible` passes for the
opposite result. An absent, hidden, empty, or fully transparent output is not
visible.

The check does not test occlusion, camera position, camera direction, or screen
framing. It does not rotate the camera, step the scene, or run Scene Context.

Use an ID when one tag identifies several outputs:

```ts
await expectVisible(session, {tag: 'item', id: selectedItemId});
```

## Capture output data

Capture snapshots for display state, bounds, transforms, materials, surfaces,
declared text, and declared paths:

```ts
const before = await captureOutputSnapshot(session);
await session.click(primaryHand);
const after = await captureOutputSnapshot(session);

expectTransformChanged(before, after, 'selected-object', {
  positionMeters: 0.01,
});
expectRenderStateChanged(before, after, 'button', ['color']);
```

Read simple or app-specific results from the snapshot with the normal test
expectation:

```ts
const result = snapshot.outputs.find((output) => output.tag === 'result');
expect(result?.text).toBe('Complete');
```

## Check spatial results

```ts
expectSpatialRelation(snapshot, 'label', 'above', 'button', {
  toleranceMeters: 0.01,
});

expectOnSurface(snapshot, 'placed-object', {
  surface: {label: 'table'},
  toleranceMeters: 0.02,
});
```

`expectSpatialRelation` supports `aligned`, `above`, and `touching`.

## Check session health

Use one health check near the end of each session test. It rejects browser
console errors, page errors, and failed network requests:

```ts
expectSessionHealthy(session);
```
