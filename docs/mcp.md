# MCP server

Start the MCP server from the root of this repo:

```sh
npx --no-install xrblocks-devtools mcp --port 3100
```

Connect each agent's MCP client:

```text
http://127.0.0.1:3100/mcp
```

The server exposes named tools with input schemas, descriptions, and agent
instructions based on the repository's
[interaction skill](../skills/interact-with-xrblocks/SKILL.md) and
[visualization skill](../skills/visualize-xrblocks/SKILL.md).

## Sessions

Each agent should open its own session and retain the returned `sessionId`.
These examples show tool names and JSON arguments, not JavaScript to evaluate.

```text
open_session({"url":"http://127.0.0.1:5173","label":"agent-a"})
→ {"sessionId":"...","label":"agent-a","url":"http://127.0.0.1:5173"}

get_scene_context({"sessionId":"...","options":{"semanticTree":true,"visibleObjects":true}})
get_screenshot({"sessionId":"...","out":"./artifacts/agent-a/before.png"})
point_to({"sessionId":"...","hand":"right","target":{"tag":"start-button"}})
click({"sessionId":"...","hand":"right"})
get_devtools_context({"sessionId":"...","options":{"state":true}})
get_screenshot({"sessionId":"...","out":"./artifacts/agent-a/after.png"})
close_session({"sessionId":"..."})
```

`open_session` accepts either `url` or `appDir`. Directory mode also accepts
`entry` and `xrblocksRoot`, starts an owned app server, and closes it with the
session. URL mode leaves the existing app server running. For many agents on
one app URL, run that app server separately, then open independent URL sessions.

Sessions run headless by default; set `headless:false` to show Chromium. Existing
session options cover viewport, timeout, real-time pacing, audio monitoring,
reach limits, navmesh, initial simulator objects, and the embodied-control import.

`list_sessions` returns IDs, labels, URLs, and closing state. Operations within
a session are queued; different sessions run concurrently. Multiple separate
calls are not an atomic sequence. Prefer independent sessions per agent, or
coordinate ownership when sharing a viewer. `ray_click` combines positioning,
aiming, and clicking in one queued call.

Client disconnects leave sessions running. Close your own sessions explicitly.
Ctrl-C or SIGTERM stops the MCP server and closes its sessions.

## Tool coverage

| Area        | Tools                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle   | `open_session`, `list_sessions`, `close_session`                                                                                    |
| Observation | `get_camera`, `get_hands`, `get_screenshot`, `get_scene_context`, `get_devtools_context`, `get_simulator_state`                     |
| Inspection  | `get_preset_location`, `find_by_tag`, `inspect`, `inspect_scene`, `get_diagnostics`                                                 |
| Viewer      | `navigate_to`, `teleport_to`, `move`, `rotate`, `look_at_target`                                                                    |
| Hands       | `move_hand`, `teleport_hand`, `rotate_hand`, `gesture`, `set_hand_pose`, `point_to`, `reach_to`                                     |
| Selection   | `start_select`, `end_select`, `click`, `ray_click`                                                                                  |
| Simulation  | `apply_control`, `step_control`, `wait`, `step_frame`                                                                               |
| Audio       | `inject_audio`, `wait_for_audio_consumer`                                                                                           |
| Objects     | `add_simulator_objects`, `update_simulator_objects`, `remove_simulator_objects`, `clear_simulator_objects`, `get_simulator_objects` |
| Artifacts   | `save_set_of_mark`; `get_screenshot` with `out` replaces the REPL's `saveScreenshot` helper                                         |
| Previews    | `visualize`                                                                                                                         |

Every interaction tool requires `sessionId`. Targets accept exact unique names,
world `[x,y,z]` coordinates in meters, or `{tag:"name"}`. Disambiguate duplicate
tags with `{tag,id}` returned by `find_by_tag`. `navigate_to` also resolves
simulator location names.

`point_to` aims a ray; `reach_to` moves the fingertip without aiming it. Hold
selection between `start_select` and `end_select` for dragging, and release it
after an error. High-level distances are meters; body/hand rotations are degrees;
hand joint rotations are radians; durations are milliseconds. Raw compound
movement uses camera-space negative Z for forward.

Simulator object inputs accept exactly one of `assetPath`, `file`, or `object`.
`object` is serialized Three.js `Object3D.toJSON()` output. No live JavaScript
objects or arbitrary REPL expressions cross the MCP interface.

## Previews and images

Previews do not require a session:

```text
visualize({"request":{"kind":"model","input":{"path":"./previews/thing.preview.ts"},"views":"inspection-4"},"out":"./artifacts/thing.png"})
visualize({"request":{"kind":"ui","input":{"source":"export default ({xb}) => new xb.UIOverlay({children: [new xb.UIText({text: 'Ready'})]});"}},"size":"1024x768"})
visualize({"request":{"kind":"hand","pose":"pointing","hand":"both","views":"front"}})
```

Model modules receive `{THREE}` and return one `THREE.Object3D`. UI modules
receive `{xb}` and return one public `UICard` or `UIOverlay`. Hand previews need
no module. Use file input for relative imports; inline source lives in a temporary
directory. Set `request.assetsDir` for assets loaded through `/assets/...`.
See [preview module contracts](../skills/visualize-xrblocks/references/preview-modules.md).

Images are returned as MCP image content alongside JSON metadata. Embedded image
data URLs in observations become image content, with zero-based `imageIndex`
references in the metadata. Inspect the images, review warnings, adjust the
source, and render again until the visual requirement is met.

`out` is optional. Without it, a preview's temporary PNG is removed after reading
it into the response. With it, the image is retained and its absolute path is
returned. Use unique output paths per agent. Paths always refer to the server's
filesystem, not a remote client's filesystem.

## Recording

Configure recording at session creation:

```text
open_session({"url":"http://127.0.0.1:5173","label":"recorded-check","recording":{"mode":"checkpoints","out":"./artifacts/recorded-check.mp4"}})
```

Video mode supports `scope` (`actions`, `scene`, or `full`), `paddingMs`, `keepRaw`,
and recording `size`. `close_session` finalizes the recording and returns its
video and manifest paths plus browser diagnostics. Existing FFmpeg requirements
apply. Inspect a recording before using it as evidence.
