# XR Blocks Devtools

Standalone tools for previewing, running, observing, and controlling XR
Blocks applications. Designed to support agentic coding and testing.

## Install

### Install from npm

Install Devtools in the XR Blocks application that will use it:

```bash
npm install --save-dev @xrblocks/devtools
npx playwright install chromium
```

Run the local CLI through `npx`:

```bash
npx xrblocks-devtools help
```

The package exposes the `xrblocks-devtools` CLI.

Install the XR Blocks v0.20 runtime peers in the application, or pass
`--xrblocks-root` when working against a source checkout:

```bash
npm install xrblocks three @pmndrs/uikit @preact/signals-core lit
```

The following optional dependencies add more functionality to XR Blocks Devtools.

```bash
npm install --save-dev tiny-tts      # injectAudio({text})
npm install --save-dev three-pathfinding # --simulator-navmesh
```

### Optional FFmpeg installation

FFmpeg is required for checkpoint MP4s, scene-scope MP4s, and action trimming:

```bash
# macOS
brew install ffmpeg

# Debian or Ubuntu
sudo apt-get install ffmpeg
```

On other systems, install an FFmpeg distribution and make sure the `ffmpeg`
executable is on `PATH`. Confirm the installation with:

```bash
ffmpeg -version
```

Without FFmpeg, full-scope WebM recording works normally. Action-scope recording
falls back to the complete raw WebM. Checkpoint and scene-scope recording report
an error because both must encode an MP4.

### Install from source

To develop Devtools itself using its pinned XR Blocks dependency:

```bash
npm ci
npm run link:cli
npx playwright install chromium
```

`link:cli` builds the project and makes `xrblocks-devtools` available through
npm's global link mechanism.

To develop against a sibling XR Blocks source checkout instead, prepare and
link that checkout before linking the CLI:

```bash
npm run setup:local
npm run link:cli
```

### Import from code

Import `XRBlocksSession` from the package root:

```ts
import {XRBlocksSession} from '@xrblocks/devtools';

const session = await XRBlocksSession.open({
  appDir: './app',
  headless: true,
});

try {
  const camera = await session.getCamera();
  await session.pointTo('right', {tag: 'start-button'});
  await session.click('right');
  const state = await session.getDevtoolsContext({state: true});
  console.log({camera, state});
} finally {
  await session.close();
}
```

Always close the session in `finally`. This releases Chromium, the local
server, recordings, and temporary workspace files. See [Session API](#session-api)
for configuration and targeting details.

## Documentation

- [Usage examples](docs/example.md) provides complete CLI, Interact, Session,
  and Agent examples.
- [Visualize UI and Models](docs/visualize.md) defines preview modules, assets,
  views, and render verification.
- [Test Applications Interactively](docs/interactive.md) covers observation,
  movement, input, audio, and recording.
- [Use Scene Context with Embodied Actions](docs/scene-context.md) explains
  targeting, developer metadata, and state verification.

## CLI

Use `xrblocks-devtools help <command>` to read help generated from the same
definitions as the parser.

### Visualize

```text
xrblocks-devtools visualize <ui|model> <module|-> -o <out.png> [options]
```

| Flag                    | Value and behavior                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `-o`, `--out <path>`    | Required PNG output path. Parent directories are created.                                               |
| `--size <WxH>`          | Output pixels. Defaults: UI `1024x768`; model `1024x1024`.                                              |
| `--bg <color>`          | CSS background color or `transparent`. Default `#f4f5f7`.                                               |
| `--views <preset>`      | Model only: `inspection-4` (default), `turntable-4`, or `front`.                                        |
| `--assets-dir <dir>`    | Files available below `/assets/`. Defaults to the module directory, or the current directory for stdin. |
| `--xrblocks-root <dir>` | UI only: XR Blocks package or checkout used for the preview.                                            |
| `-h`, `--help`          | Show command help.                                                                                      |

Use `-` as the module to read TypeScript source from stdin. A UI module receives
`{xb}` and returns exactly one public `xb.UICard` or `xb.UIOverlay`. A model
module receives `{THREE}` and returns exactly one `THREE.Object3D`.

```js
export default function preview({xb}) {
  return new xb.UIOverlay({
    children: [new xb.UIText({text: 'Ready'})],
  });
}
```

The result is `{out, warnings}`. UI warnings also print to stderr. See
[docs/visualize.md](docs/visualize.md).

### Interact

```text
xrblocks-devtools interact (--app-dir <dir> | --url <url>) [options]
```

| Flag                                 | Value and behavior                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `--app-dir <dir>`                    | Copy and serve one browser-runnable application directory. Exactly one of `--app-dir` and `--url` is required. |
| `--url <url>`                        | Attach to an application that is already served.                                                               |
| `--xrblocks-root <dir>`              | App-directory only: XR Blocks package or checkout used by the copied workspace.                                |
| `--entry <path>`                     | App-directory only: HTML page inside the copied app. Default `index.html`.                                     |
| `--headed`                           | Show Chromium. Sessions are headless by default.                                                               |
| `--monitor-audio`                    | Play injected microphone audio through Chromium output. Default false.                                         |
| `--no-realtime`                      | Disable real-time embodied-control pacing. Real-time pacing is enabled by default.                             |
| `--simulator-reach-limit`            | Enforce the simulator hand-reach radius.                                                                       |
| `--simulator-navmesh`                | Reload the active simulator environment with its navmesh enabled, then constrain `navigateTo()`.               |
| `--embodied-control-import <module>` | Browser-loadable module specifier or URL for the embodied-control addon. Useful for URL sessions.              |
| `--timeout-ms <ms>`                  | Browser startup and operation timeout. Default `300000`.                                                       |
| `--record-video <path>`              | Record action windows. Trimming targets MP4 when ffmpeg is available.                                          |
| `--record-checkpoints <path>`        | Record the initial frame, each action result, and the final frame.                                             |
| `--record-video-padding-ms <ms>`     | Time retained before and after actions. Default `500`.                                                         |
| `--record-video-scope <scope>`       | Keep `actions`, everything after `scene` readiness, or the `full` WebM. Default `actions`.                     |
| `--keep-raw-video`                   | Preserve Playwright's raw WebM after successful trimming.                                                      |
| `-h`, `--help`                       | Show flags and REPL functions.                                                                                 |

The prompt is a JavaScript REPL. Call functions directly; returned promises are
awaited automatically:

```js
getSimulatorState();
getSceneContext({semanticTree: true, visibleObjects: true});
pointTo('right', 'Start Button');
click('right');
saveScreenshot('./artifacts/after.png');
```

Exit with `.exit` or Ctrl-D. Exit always closes Chromium, finalizes recording,
stops the local server, and removes the copied workspace.

### Agent

```text
xrblocks-devtools agent (--app-dir <dir> | --url <url>) --task <text> [options]
```

The agent command accepts all Interact session and recording flags plus:

| Flag                               | Value and behavior                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--task <text>`                    | Required natural-language task.                                                                                                                                                     |
| `--model <model>`                  | Gemini model. Default `gemini-3.8-flash`.                                                                                                                                           |
| `--max-turns <count>`              | Positive model-turn limit. Default `30`.                                                                                                                                            |
| `--judge-trajectory <requirement>` | Judge the completed trajectory and print both the action result and `{verdict, reason}`.                                                                                            |
| `--record-agent <dir>`             | Write each trajectory as JSONL and save its observation images.                                                                                                                     |
| `--observations <kinds>`           | `all` or comma-separated `image`, `semantic-tree`, `visible`, `som`, `locations`, `devtools-tags`, `state`, `spatial`, and/or `view`. The default excludes `locations` and `state`. |
| `--quiet`                          | Suppress progress events on stderr.                                                                                                                                                 |
| `-h`, `--help`                     | Show command help.                                                                                                                                                                  |

At startup, the CLI loads an optional `.env` file from the current working
directory. Existing shell variables take priority. AI features use Google AI by
default. Install its optional provider and set its API key:

```sh
npm install @ai-sdk/google
```

```env
XRBLOCKS_DEV_TOOLS_AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=your-key
```

Only `agent` requires the provider before opening Chromium; `interact` can start
without it.

`GEMINI_API_KEY` is also accepted. Devtools maps it to
`GOOGLE_GENERATIVE_AI_API_KEY` when the standard variable is not set.

To use Vertex AI, install its optional provider:

```sh
npm install @ai-sdk/google-vertex
```

Then set the provider and Vertex configuration:

```env
XRBLOCKS_DEV_TOOLS_AI_PROVIDER=vertex
GOOGLE_VERTEX_PROJECT=your-project
GOOGLE_VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

Vertex uses Application Default Credentials. If
`XRBLOCKS_DEV_TOOLS_AI_PROVIDER` is not set, the tool uses `google`.

Set `XRBLOCKS_DEVTOOLS_BROWSER_PROFILE=container` when running in Docker or
containerized CI environments. This launches Chromium with container-friendly
flags including `--no-sandbox`, `--disable-setuid-sandbox`,
`--disable-dev-shm-usage`, and `--ignore-gpu-blocklist`.

Set `XRBLOCKS_DEVTOOLS_BROWSER_PROFILE=container-software` when a container
does not have a reliable GPU. This uses the same container flags and selects
ANGLE with SwiftShader for deterministic software rendering.

### Test

Write ordinary and session tests with the package test export:

```ts
import {expect, it, it_session} from '@xrblocks/devtools/test';

it('publishes a texture', () => {
  expect(createTexture()).toBeDefined();
});

it_session(
  'selects with either hand',
  {
    switchHands: true,
    recording: 'selection',
  },
  async (session, {primaryHand}) => {
    await session.click(primaryHand);
  }
);
```

Use tagged-output expectations to verify visible and spatial results:

```ts
import {
  captureOutputSnapshot,
  expect,
  expectNotVisible,
  expectSessionHealthy,
  expectVisible,
  it_session,
} from '@xrblocks/devtools/test';

it_session('opens the settings menu', async (session) => {
  await expectNotVisible(session, 'settings-menu');
  await session.click('right');
  await expectVisible(session, 'settings-menu');

  const snapshot = await captureOutputSnapshot(session, {
    tags: ['settings-title'],
  });
  expect(snapshot.outputs[0]?.text).toBe('Settings');
  expectSessionHealthy(session);
});
```

Each snapshot records tagged IDs, transforms, bounds, display state, material
state, geometry, declared text, and declared paths. Visibility checks use scene hierarchy,
geometry, material visibility, transparency, and opacity. See
[Tagged output expectations](docs/output-expectations.md) for all helpers.

When `--xrblocks-root` is set, ordinary tests can import the selected source
tree through `@xrblocks/source`:

```ts
import {DepthTextures} from '@xrblocks/source/depth/DepthTextures.ts';
import {DepthOptions} from '@xrblocks/source/depth/DepthOptions.ts';
import {expect, it} from '@xrblocks/devtools/test';

it('publishes CPU depth data', () => {
  const options = new DepthOptions({usagePreference: ['cpu-optimized']});
  const textures = new DepthTextures(options);
  expect(textures.depthData).toEqual([]);
});
```

Use ordinary tests for isolated behavior. Use session tests when the behavior
must run through an application or the XR simulator. A bare `three` import uses
the selected checkout's Three.js dependency so the test and source share their
class identities.

Use `judge` for a binary AI evaluation of text or image evidence:

```ts
import {judge} from '@xrblocks/devtools/test';

const judgment = await judge({
  prompt: 'Does the image show a clearly visible red cube?',
  evidence: [
    {type: 'image', label: 'Final camera view', image: screenshotDataUrl},
  ],
});

expect(judgment.verdict, judgment.reason).toBe(true);
```

Evidence can contain ordered `text`, `data`, and `image` items. The judge uses
an internal system instruction and deterministic Gemini output. Missing or
invalid credentials and request failures throw `VerifierError`. The test runner
reports these as verifier errors and does not score the candidate.

Both `judge()` and `judgeTrajectory()` accept an optional JSON schema for
additional structured fields. Custom schemas must retain the Boolean `verdict`
and string `reason` fields.

Use `judgeTrajectory` to evaluate one requirement from an `act()` result. The
default result is a Boolean verdict with one reason:

```ts
import {expect, judgeTrajectory} from '@xrblocks/devtools/test';

const actResult = await session.act('Select the red cube.');
const verdict = await judgeTrajectory({
  requirement: 'The red cube is selected.',
  trajectory: actResult.trajectory,
});

expect(verdict.verdict, verdict.reason).toBe(true);
```

Run one test file against one prepared application:

```text
xrblocks-devtools test tests/evaluation.ts --app ./app [options]
```

| Flag                    | Value and behavior                                                 |
| ----------------------- | ------------------------------------------------------------------ |
| `--app <dir>`           | Required browser-runnable application directory.                   |
| `--xrblocks-root <dir>` | XR Blocks checkout used by the application and `@xrblocks/source`. |
| `--entry <path>`        | HTML page inside the application. Default `index.html`.            |
| `--output <dir>`        | Result and recordings. Default `artifacts/xrblocks-test`.          |
| `--timeout-ms <ms>`     | Browser startup timeout for session tests. Default `300000`.       |
| `--judge-model <model>` | Model used by `judge()`. Overrides the default.                    |
| `-h`, `--help`          | Show command help.                                                 |

Each test run contributes equally to the score. Hand and scene variants count
as separate test runs. Set `required: true` to make any failed variant set the
score to `0`. Session tests receive the complete `XRBlocksSession`. `realTime`
defaults to `false`. A session test records only when its options include a
simple `recording` name. Actor tool actions use the normal Session action path,
so checkpoint recordings include a frame after each actor action. Session tests
do not write separate actor trajectory or observation-image artifacts.

Session tests can set `viewport: {width, height}` for the browser. The browser
viewport defaults to `1280 × 960`.

Use `scenes` to run a session test against XR Blocks SDK environments or custom
simulator manifests. SDK environments use their display names. Manifest paths
are relative to the application page. If `scenes` is omitted or empty, the SDK
default environment remains active.

```ts
it_session(
  'works in each room',
  {scenes: ['Living Room', 'Office', {path: './scenes/table.json'}]},
  async (session, run) => {
    // run.scene identifies the active scene variant.
  }
);
```

## Interactive function reference

Targets are a live Scene Context ID such as `ctx_1`, an exact unique
scene/context name, a world position `[x, y, z]` in meters, or `{tag: 'name'}`.
`left` and `right` select physical hands.

### Observe and save evidence

| Function                          | Result or effect                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getCamera(options?)`             | Camera world position in meters and `[x,y,z,w]` quaternion. `{screenshot: true}` also returns a PNG data URL. |
| `getHands()`                      | Left and right hand position in meters, `[x,y,z,w]` quaternion, visibility, selection, and squeeze state.     |
| `getScreenshot(options?)`         | PNG data URL. `overlayOnCamera` defaults to true.                                                             |
| `saveScreenshot(path, options?)`  | Save a PNG and return its absolute `{out}` path.                                                              |
| `getSceneContext(options)`        | Select `semanticTree`, `visibleObjects`, and/or `setOfMark`. At least one must be true.                       |
| `saveSetOfMark(path)`             | Capture Set-of-Mark, save its image, and return mark metadata plus `out`.                                     |
| `getDevtoolsContext(options)`     | Select developer `tags`, declared `state`, `spatial`, and/or `view` measurements.                             |
| `getSimulatorState()`             | Timestamp, running state, and pause state.                                                                    |
| `inspectScene()`                  | Serializable scene hierarchy, camera, simulator, and world data.                                              |
| `findByTag(tag)`                  | All identities with an exact Devtools tag.                                                                    |
| `inspect(target)`                 | Identity, metadata, visibility, hierarchy, and local/world transforms.                                        |
| `addSimulatorObjects(defs)`       | Spawn simulator objects from local files, asset URLs, or Three.js meshes.                                     |
| `updateSimulatorObjects(updates)` | Update transform, visibility, label, or physics for active simulator objects.                                 |
| `removeSimulatorObjects(ids)`     | Remove simulator objects by ID.                                                                               |
| `clearSimulatorObjects()`         | Remove all simulator objects from the environment.                                                            |
| `getSimulatorObjects(ids?)`       | Retrieve simulator object records.                                                                            |
| `diagnostics()`                   | Browser console, page, and failed-network-request entries.                                                    |

### Move and interact

| Function                            | Units, defaults, and behavior                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `navigateTo(target)`                | Use XR Blocks simulator navigation and navmesh constraints. Returns final position and `constrained`.                                     |
| `teleportTo(target, options?)`      | Embodied teleport. Options include `distance` in meters (default `1.5`), `faceTarget` (default true), and `snapToGround` (default false). |
| `move(motion)`                      | Viewer-relative meters. Speed default `3 m/s`, range `0.05–20 m/s`. Positive axes are right, up, and forward.                             |
| `rotate(rotation)`                  | Relative degrees. Speed default `360°/s`, range `5–3600°/s`. Positive pitch is up, yaw left, roll counterclockwise.                       |
| `moveHand(hand, motion)`            | Viewer-relative meters. Speed default `2 m/s`, range `0.05–20 m/s`.                                                                       |
| `rotateHand(hand, rotation)`        | Relative degrees. Speed default `360°/s`, range `5–3600°/s`.                                                                              |
| `gesture(hand, pose)`               | Apply `neutral`, `relaxed`, `pinching`, `fist`, `thumbs_up`, `pointing`, `rock`, `thumbs_down`, or `victory` over 500 ms.                 |
| `setHandPose(hand, rotations)`      | Apply sparse named joint `[x,y,z]` rotations in radians over 500 ms.                                                                      |
| `lookAtTarget(target, options?)`    | Camera speed in degrees/s; default `360`, range `5–3600`.                                                                                 |
| `pointTo(hand?, target?, options?)` | Aim a controller ray. Right hand and `360°/s` default.                                                                                    |
| `reachTo(hand?, target?, options?)` | Move the index fingertip to a target. Right hand and `2 m/s` default; range `0.05–20`.                                                    |
| `startSelect(hand?)`                | Begin and hold WebXR selection. Default right.                                                                                            |
| `endSelect(hand?)`                  | Release selection. Default right.                                                                                                         |
| `click(hand?, options?)`            | Select press and release. Default right and `durationMs: 200`.                                                                            |
| `wait(durationMs)`                  | Advance real and simulation time by a positive number of milliseconds.                                                                    |
| `stepFrame(frames?)`                | Advance positive frame count; default one frame at about 16.67 ms.                                                                        |
| `injectAudio({file})`               | Inject a RIFF/WAVE file, maximum 25 MB.                                                                                                   |
| `injectAudio({text})`               | Synthesize and inject up to 500 characters through optional TinyTTS.                                                                      |

Low-level `applyControl(control)` applies a compound embodied control
immediately. `stepControl({durationMs?, control?})` applies it while advancing
frames. Locomotion and hand movement tuples use meters; rotation tuples use
degrees; sparse hand-joint rotations use radians.

The compound control shape is:

```ts
{
  locomotion?: {
    move?: [rightMeters, upMeters, forwardMeters];
    rotate?: [pitchDegrees, yawDegrees, rollDegrees];
  };
  leftHand?: {
    move?: [xMeters, yMeters, zMeters];
    rotate?: [pitchDegrees, yawDegrees, rollDegrees];
    selectStart?: boolean;
    selectEnd?: boolean;
    pose?: NamedHandPose;
    rotations?: Record<JointName, [xRadians, yRadians, zRadians]>;
    visible?: boolean;
  };
  rightHand?: {/* same fields */};
}
```

`stepControl` distributes movement and rotation over `durationMs`; the default
is one 16.67 ms tick. `applyControl` applies the complete values immediately and
does not advance a frame. A hand control can use a named `pose` or custom
`rotations`, and selection is a separate control.

Valid joint names are `wrist`; `thumb-metacarpal`,
`thumb-phalanx-proximal`, `thumb-phalanx-distal`; and the `metacarpal`,
`phalanx-proximal`, `phalanx-intermediate`, and `phalanx-distal` joints for
`index-finger`, `middle-finger`, `ring-finger`, and `pinky-finger`. The thumb
has no intermediate joint.

See [docs/interactive.md](docs/interactive.md) for complete scenarios and
[docs/scene-context.md](docs/scene-context.md) for context-driven targeting.

## Session API

```ts
import {XRBlocksSession} from '@xrblocks/devtools';

const session = await XRBlocksSession.open({
  appDir: './app',
  xrblocksRoot: '../xrblocks',
  headless: true,
});

try {
  await session.navigateTo({tag: 'workbench'});
  await session.click('right');
} finally {
  await session.close();
}
```

Session accepts exactly one of `appDir` and `url`. App-directory sessions can
also set `xrblocksRoot` and `entry`. Shared options are `headless`, `timeoutMs`,
`viewport` in pixels, `realTime`, `monitorAudio`, `simulatorReachLimit`,
`simulatorNavMesh`,
`embodiedControlImport`, `recording`, `recordAgent`, and `signal`.

URL sessions bypass workspace injection. Their page must expose XR Blocks debug
state through `?xrAutomation=1&debug=1` and resolve the embodied-control addon.
Set `embodiedControlImport` to a browser-loadable URL when needed.

Session recording has two modes:

```ts
const checkpoints = await XRBlocksSession.open({
  appDir: './app',
  recording: {mode: 'checkpoints', out: './artifacts/run.mp4'},
});

const motion = await XRBlocksSession.open({
  appDir: './app',
  recording: {
    mode: 'video',
    out: './artifacts/run.mp4',
    scope: 'actions',
    paddingMs: 500,
  },
});
```

`checkpoints` captures the initial page, the result of every Session action,
and the final page. `video` uses Playwright video. Its `scope` is `actions` by
default, `scene` keeps continuous video after scene readiness, and `full` keeps
the complete WebM. `session.close()` returns `{diagnostics, recording,
agentRuns}`. The recording result contains the actual `videoPath` and its
automatically derived `manifestPath`.

Action-scope video does not require a separate input file. The recorder measures
each Session action in memory while Playwright records the page. On close, it adds
the configured padding, merges overlapping action windows, and gives the
resulting segments directly to FFmpeg. FFmpeg selects those frames,
and `setpts` removes the gaps between segments without dropping frames inside
an action window. DevTools then writes `<video-name>.recording.json` as an
output record of the actions, merged segments, selected scope, actual video
path, and any raw fallback. The manifest is evidence about the completed
recording, not an input needed to trim it.

### Developer metadata (tags and state)

Application objects can declare stable metadata, custom tags, and state without changing other `userData`:

```js
object.userData.xrblocksDevtools = {
  tag: 'start-button',
  state: {
    enabled: true,
    // Dynamic state / function calls are evaluated as getters when inspected:
    get score() {
      return calculateScore();
    },
  },
};
```

Devtools reads only `userData.xrblocksDevtools`. `state` must contain finite, cycle-free JSON data (dynamic state functions should be declared as getters rather than raw function values).

You can query tagged objects and grab their evaluated state:

```ts
// Find objects by tag
const items = await session.objects.findByTag('start-button');

// Inspect a single object and read its evaluated state
const inspection = await session.objects.inspect({tag: 'start-button'});
console.log(inspection.state); // { enabled: true, score: 42 }

// Grab all tags, states, spatial, and view data across the scene
const context = await session.getDevtoolsContext({
  tags: true,
  state: true,
  spatial: true,
  view: true,
});
```

Tagged objects can also be passed directly as targets to embodied actions:

```ts
await session.lookAtTarget({tag: 'start-button'});
await session.pointTo('right', {tag: 'start-button'});
await session.reachTo('right', {tag: 'start-button'});
```

### Simulator objects (spawning and environment)

Simulator objects are intended to simulate physical objects in the environment (such as furniture, physical props, obstacles, or real-world items). Devtools can dynamically spawn, update, and manage these objects in the XR Blocks simulator environment using `session.simulator`.

Objects configured with `detectObject: true` and a `label` are directly read into the XR Blocks `objects` module, allowing apps to run object detection simulations against spawned physical items.

Objects support:

1. **Local filesystem 3D models**: `file: './tests/fixtures/model.glb'` (automatically read into data URLs).
2. **Application or remote assets**: `assetPath: './models/chair.glb'` or `https://...`.
3. **Three.js objects**: `object: makePlaceholder()`. DevTools serializes the
   object into the browser before inserting it into the simulator.

Spawned objects can declare Devtools tags, states, semantic detection labels, and physics:

```ts
import * as THREE from 'three';

function makePlaceholderPackage() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.15),
    new THREE.MeshStandardMaterial({color: 0xb8895a})
  );
}

// Spawn simulator objects dynamically
await session.simulator.addObjects([
  {
    id: 'fixture-table',
    tag: 'fixture-table',
    file: './tests/fixtures/table.glb',
    position: [0, 0.8, -1.0],
    physics: 'fixed',
    detectObject: true,
    label: 'Table',
  },
  {
    id: 'package-1',
    tag: 'target-package',
    object: makePlaceholderPackage(),
    state: {score: 10},
    position: [0, 1.2, -1.0],
    physics: 'dynamic',
  },
]);

// Target or inspect the spawned object immediately
await session.lookAtTarget({tag: 'target-package'});
await session.reachTo('right', {tag: 'target-package'});
const inspection = await session.objects.inspect({tag: 'target-package'});

// Update, query, or remove simulator objects
await session.simulator.updateObjects([
  {id: 'package-1', position: [0.5, 1.2, -1.0]},
]);
const records = await session.simulator.getObjects();
await session.simulator.removeObjects(['package-1']);
await session.simulator.clearObjects();
```

Initial simulator objects can also be declared in `XRBlocksSessionConfig` or `it_session` options:

```ts
const session = await XRBlocksSession.open({
  appDir: './app',
  simulatorObjects: [
    {tag: 'workbench', file: './fixtures/workbench.glb', physics: 'fixed'},
  ],
});
```

`session.act()` is a programmatic action loop built on AI SDK Core. It requires
the credentials for the selected AI provider. Google AI uses
`GOOGLE_GENERATIVE_AI_API_KEY`. Vertex AI uses Application Default Credentials.
It returns a status, token and turn usage, and a complete trajectory. A
completed run also contains the agent's `exit` message and any optional JSON
data.

```ts
const result = await session.act('Select the red cube.', {
  maxTurns: 20,
  maxRetries: 6,
  timeoutMs: 40_000,
});

console.log(result.status, result.exit, result.trajectory);
```

The default `targeted` profile provides incremental body and hand controls, a
bounded `wait` action, and named target actions such as `look_at_target`,
`point_to_target`, `reach_to_target`, and `click`. Pass
`toolProfile: 'primitive'` to `session.act()` when a task must use only
incremental controls.
The agent always receives the `exit` tool. DevTools tags are untrusted navigation
hints. They do not prove that the app met a requirement.

Set `recordAgent: {outDir}` in `XRBlocksSessionConfig` to save each run as JSONL
and separate image files. Session tests set this option automatically. Use
`judgeTrajectory()` to turn a trajectory and optional supporting evidence into
`{verdict, reason}`. Keep the final assertion explicit with Vitest `expect()`.

## Keep Your API Key Secure

In specific AI use
cases, this tool provides an interface to use cloud-hosted Gemini services, requiring an API key from
[AI Studio](https://aistudio.google.com/app/apikey). Please follow
[this doc](https://ai.google.dev/gemini-api/docs/api-key#security) for best
practices to keep your API key secure.

Treat your Gemini API key like a password. If compromised, others can use your
project's quota, incur charges (if billing is enabled), and access your private
data, such as files.

### Critical Security Rules

Never commit API keys to source control. Do not check your API key into version
control systems like Git.

Never expose API keys on the client-side. Do not use your API key directly in
web or mobile apps in production. Keys in client-side code (including our
JavaScript/TypeScript libraries and REST calls) can be extracted.

## Shipped skills

- [`visualize-xrblocks`](skills/visualize-xrblocks/SKILL.md) runs an isolated
  render-and-inspect loop.
- [`interact-with-xrblocks`](skills/interact-with-xrblocks/SKILL.md) runs an
  observe-act-verify loop through the manual REPL.

The npm package contains these skill folders. Agent hosts must expose or install
them through their normal skill-discovery mechanism.

## Terms of Service

- Please follow
  [Google's Privacy & Terms](https://policies.google.com/privacy?hl=en-US)
  when using this SDK.

- When using AI features in this SDK, please follow
  [Gemini's Privacy & Terms](https://ai.google.dev/gemini-api/terms).
