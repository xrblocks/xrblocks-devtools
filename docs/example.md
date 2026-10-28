# Usage Examples

These examples show the common XR Blocks Devtools workflows. Run commands from
the application repository unless an example says otherwise.

## Render a UI preview

Create `status-card.preview.ts`:

```ts
export default function preview({xb}) {
  return new xb.UICard({
    size: {width: 0.6, height: 0.35},
    children: [new xb.UIText({text: 'System ready'})],
  });
}
```

Render it to a PNG:

```bash
npx xrblocks-devtools visualize ui status-card.preview.ts \
  --xrblocks-root ../xrblocks \
  --size 1024x768 \
  --out artifacts/status-card.png
```

See [Visualize UI and Models](visualize.md) for module contracts, model views,
assets, and the render evidence loop.

## Inspect and control an application

Open an application in a visible browser. Install its dependencies first.
DevTools launches Vite for Vite projects and serves a copied workspace for
browser-ready static apps. Use `--url` when a server is already running:

```bash
npx xrblocks-devtools interact \
  --app-dir ./app \
  --xrblocks-root ../xrblocks \
  --headed
```

At the `xrblocks>` prompt, inspect the scene, aim at a button, click it, and
save evidence:

```js
getSceneContext({semanticTree: true, visibleObjects: true});
pointTo('right', 'Start Button');
click('right');
getDevtoolsContext({state: true, view: true});
saveScreenshot('./artifacts/after-start.png');
```

Exit with `.exit` or Ctrl-D. Devtools closes Chromium and its temporary server.

See [Test Applications Interactively](interactive.md) for movement, hand
control, audio injection, recording, and compound controls.

## Drag a tagged object

Applications can expose stable targets through Devtools metadata:

```js
cube.userData.xrblocksDevtools = {
  tag: 'red-cube',
  state: {placed: false},
};
```

Use the tag from Interact mode:

```js
reachTo('right', {tag: 'red-cube'});
startSelect('right');
reachTo('right', {tag: 'red-target'});
endSelect('right');
inspect({tag: 'red-cube'});
```

See [Use Scene Context with Embodied Actions](scene-context.md) for target
forms, state declarations, and verification patterns.

## Run a programmatic session

Use `XRBlocksSession` when another Node.js tool owns the workflow:

```ts
import {XRBlocksSession} from '@xrblocks/devtools';

const session = await XRBlocksSession.open({
  appDir: './app',
  xrblocksRoot: '../xrblocks',
  headless: true,
});

try {
  const before = await session.getDevtoolsContext({state: true});
  await session.pointTo('right', {tag: 'start-button'});
  await session.click('right');
  const after = await session.getDevtoolsContext({state: true});
  console.log({before, after});
} finally {
  await session.close();
}
```

Always close the session in `finally` so Chromium, recording resources, and
temporary workspaces are released.

## Run a natural-language task

Provide a Gemini API key:

```bash
echo "GOOGLE_GENERATIVE_AI_API_KEY=your-key" >> .env
npx xrblocks-devtools agent \
  --app-dir ./app \
  --task 'Open the settings panel and verify that spatial audio is enabled' \
  --headed
```

Use the Agent command for exploratory actions. Keep assertions and scoring in
the test or benchmark system that invokes Devtools.

## Run the included applications

This repository includes interactive examples:

```bash
cd examples/object-interaction
npm install
npx xrblocks-devtools interact \
  --app-dir . \
  --xrblocks-root ../../../xrblocks \
  --headed
```

The same command works from `examples/ball-pit`.
