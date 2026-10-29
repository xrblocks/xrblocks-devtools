# Test Applications Interactively

Interact mode opens a complete XR Blocks application in a controlled Chromium
Session and attaches a JavaScript REPL. Expressions that return promises are
waited automatically.

## Start and stop

```bash
xrblocks-devtools interact \
  --app-dir ./app \
  --xrblocks-root ../xrblocks \
  --headed
```

Install the app's dependencies before opening it. `--app-dir` detects Vite
from the app's dependencies or `vite.config.*`, runs the installed Vite with the
project configuration, and transforms the injected addon. Browser-ready static
apps use a temporary copied workspace. Use `--url http://127.0.0.1:XXXX` to
attach to an existing server instead. For URL mode, the page must resolve the
embodied-control addon, or supply `--embodied-control-import` with a loadable URL.

At `xrblocks>`, call functions without `await session.` boilerplate:

```js
getSimulatorState();
move({forwardMeters: 0.5});
saveScreenshot('./artifacts/after.png');
```

The REPL waits when a promise is the expression result. Use top-level `await`
when an assignment or a larger JavaScript expression needs the resolved value:

```js
const box = await inspect({tag: 'draggable-box'});
box.worldTransform.position;
```

When finished developing or testing, enter `.exit` or Ctrl-D. This closes the REPL and browser inspection session, stops the
browser's frame loop, closes the local server, finalizes video, and removes
temporary workspaces. SIGINT and SIGTERM request the same cleanup.

## Observe, act, verify

Use one evidence loop:

```js
saveScreenshot('./artifacts/click/01-before.png');
getSceneContext({semanticTree: true, visibleObjects: true});
pointTo('right', 'Start Button');
click('right');
stepFrame(2);
getSceneContext({visibleObjects: true});
getDevtoolsContext({state: true, view: true});
saveScreenshot('./artifacts/click/02-after.png');
```

An action result proves that input completed. The repeated observation proves
whether the application changed correctly.

## Drag an object

```js
await inspect({tag: 'draggable-box'});
reachTo('right', {tag: 'draggable-box'});
startSelect('right');
reachTo('right', {tag: 'delivery-target'});
endSelect('right');
stepFrame(2);
await inspect({tag: 'draggable-box'});
saveScreenshot('./artifacts/drag/after.png');
```

Always release a held selection after an error before starting another action
sequence.

## Voice input

First activate the app's microphone or speech-recognition flow, for example by
clicking its actual Listen control. The synthetic microphone supplies input
to that consumer; it does not start the app's voice feature for you.

```js
injectAudio({text: 'open inventory'});
getDevtoolsContext({state: true});
```

`injectAudio` automatically waits for an active consumer. The wait uses the
session's `timeoutMs` (`--timeout-ms` in the CLI), defaulting to 300000 ms. It
reports a timeout if the app never starts listening. The optional Session method
`waitForAudioConsumer({timeoutMs})` can separately inspect readiness when needed.
`injectAudio({text})` requires the optional `tiny-tts` package and
accepts up to 500 characters. Use `injectAudio({file: './speech.wav'})` for an
existing RIFF/WAVE file without TinyTTS. Audio must contain non-silent samples,
be at most 25 MB, and last at most 60 seconds. Only one injection can run at a time.
Use `--monitor-audio` to hear the injected audio.

Injection waits for playback to finish. Wait for the app's observable result,
then verify its state or visual output.

## Recording

FFmpeg must be installed and available on `PATH` to trim recorded action
windows and encode MP4 output:

```bash
xrblocks-devtools interact \
  --app-dir ./app \
  --record-video ./artifacts/session.mp4
```

Action methods create recording windows. With ffmpeg, overlapping padded
windows are merged and transcoded to MP4. Without ffmpeg, Devtools keeps a raw
WebM and records the skip reason in the recording manifest. Close the REPL
before inspecting final recording files.

The full flag and function reference is in the package
[README](../README.md#interactive-function-reference).

## Low-level compound control

Use the high-level functions for ordinary movement. Use a compound control when
the viewer and hands must change in one timed step:

```js
stepControl({
  durationMs: 500,
  control: {
    locomotion: {move: [0, 0, -0.25], rotate: [0, 15, 0]},
    rightHand: {move: [0, 0, -0.1], selectStart: true},
  },
});
```

Movement tuples use camera-relative meters: +X right, +Y up, -Z forward. Rotation tuples use degrees. `durationMs` is the
whole step duration. `applyControl(control)` applies the same shape immediately
without advancing a frame.
