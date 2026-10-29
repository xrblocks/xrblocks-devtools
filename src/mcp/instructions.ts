export const instructions = `XR Blocks Devtools provides isolated visual previews and live XR app sessions.

Choose the smallest workflow that answers the question:
- visualize: appearance, layout, geometry, materials, framing, or hand poses in a still image.
- open_session and interaction tools: full app lifecycle, controller input, voice input, movement, runtime state, or integration behavior.

Live app workflow:
1. Define one observable postcondition and choose evidence that can prove it: image, semantic context, declared state, object transform, hand state, or diagnostics.
2. Open your own session with appDir or url and an identifying label. Retain the returned sessionId and supply it to every session tool. Directory mode starts an owned app server; url mode uses an existing server. For parallel agents on the same app server, each opens its own session using that URL. These are separate browser worlds unless the app synchronizes them.
3. Capture a baseline screenshot and relevant context. Discover targets from live evidence. Prefer {tag: "name"}; disambiguate duplicate tags with {tag, id} from find_by_tag. Plain strings mean exact unique scene/context names, not tags. World coordinate targets are [x,y,z] in meters. navigate_to also accepts simulator location names; discover them with get_devtools_context({options:{locations:true}}).
4. Perform the smallest embodied sequence. point_to aims a ray; reach_to moves the fingertip without aiming the ray. click presses and releases selection. ray_click positions, aims, and clicks in one operation. For dragging, reach_to, start_select, reach_to, end_select. Release held selection after errors before changing scenarios.
5. Capture the same evidence afterward. Action completion proves input delivery, not app correctness. Inspect returned images before claiming visual success. Refresh scene/view context after changes. Use get_diagnostics to investigate browser errors.
6. Close your session with close_session and retain recording paths and diagnostics. Do not close another agent's session or stop the shared MCP server. Client disconnects leave sessions running; server shutdown closes all sessions. Calls within a session are queued, but a sequence of separate calls is not atomic.

Units and controls:
High-level movement uses meters, with positive forwardMeters moving forward. Viewer movement defaults to 3 m/s, hand movement to 2 m/s. Body/hand rotation uses degrees (YXZ); positive pitch is up, yaw left, roll counterclockwise, default 360 degrees/s. Joint rotations in set_hand_pose and hand previews use radians. Timing uses milliseconds. Prefer high-level tools; raw compound move tuples use camera-space -Z for forward. Activate the app's listening control before inject_audio; text requires TinyTTS and file input requires WAV. Verify recognition or the app response separately from delivery.

Preview workflow:
Reuse a browser-safe builder through a thin JavaScript/TypeScript module with a default sync or async function. Model modules receive {THREE} and return exactly one THREE.Object3D. UI modules receive {xb} and return exactly one public xb.UICard or xb.UIOverlay; UICard requires size:{width,height} in meters. Do not add objects to a scene or access the renderer. Hand previews need no module.
Use input:{path} for modules with relative imports; input:{source} is materialized in a temporary directory. Load assets through /assets/... with assetsDir pointing at their root. Models/hands default to inspection-4; turntable-4 shows four sides, and front gives one view. Inspect the returned image for clipping, scale, materials, legibility, spacing, and asset loading; adjust and render again. Review warnings. Rendering success alone does not prove appearance is correct. First hand preview use downloads cached models and requires network access.

All filesystem paths refer to the server machine and resolve relative to its working directory. Use distinct output paths per agent. Images are returned inline; supply out to keep an artifact. get_screenshot with out also covers the REPL saveScreenshot helper. Configure recording when opening a session; close_session finalizes it. After a full app page reload, reopen the XR session to restore its harness.`;
