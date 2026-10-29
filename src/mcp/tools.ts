import {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {XRBlocksSession} from '../session/index.js';
import {visualize} from '../visualize/index.js';
import {Sessions} from './sessions.js';
import {saveImage, toolResult} from './results.js';
import * as s from './schemas.js';
import {instructions} from './instructions.js';

export function createTools(sessions: Sessions, signal: AbortSignal) {
  const server = new McpServer(
    {name: 'xrblocks-devtools', version: '0.1.0'},
    {instructions}
  );

  function tool<T>(
    name: string,
    description: string,
    inputSchema: z.ZodType<T>,
    execute: (args: T) => unknown | Promise<unknown>,
    readOnly = false
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {readOnlyHint: readOnly},
      },
      async (args) => {
        try {
          signal.throwIfAborted();
          return toolResult(await execute(args));
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      }
    );
  }

  function sessionTool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    execute: (
      session: XRBlocksSession,
      args: z.infer<z.ZodObject<S>>
    ) => unknown | Promise<unknown>,
    readOnly = false
  ) {
    const input = z.strictObject({sessionId: s.text, ...shape}) as z.ZodType<
      z.infer<z.ZodObject<S>> & {sessionId: string}
    >;
    tool(
      name,
      description,
      input,
      (args) =>
        sessions.run(args.sessionId, (session) => execute(session, args)),
      readOnly
    );
  }

  tool(
    'open_session',
    'Open an independent XR browser session from an app directory or URL. Retain sessionId for subsequent calls. Paths are relative to the server working directory.',
    s.openSession,
    ({label, appDir, url, xrblocksRoot, entry, simulatorObjects, ...options}) =>
      sessions.open(
        {
          ...options,
          ...(url ? {url} : {appDir: appDir!, xrblocksRoot, entry}),
          simulatorObjects:
            simulatorObjects && s.materializeObjects(simulatorObjects),
        },
        label
      )
  );
  tool(
    'list_sessions',
    'List shared XR sessions. Sessions survive client disconnects.',
    z.strictObject({}),
    () => ({sessions: sessions.list()}),
    true
  );
  tool(
    'close_session',
    'Close an XR session, finalize recordings, and return diagnostics and artifact paths.',
    z.strictObject({sessionId: s.text}),
    ({sessionId}) => sessions.close(sessionId)
  );

  sessionTool(
    'get_camera',
    'Read camera state, optionally including a screenshot.',
    {
      options: z
        .strictObject({
          screenshot: z.boolean().optional(),
          overlayOnCamera: z.boolean().optional(),
        })
        .optional(),
    },
    (session, {options}) => session.getCamera(options),
    true
  );
  sessionTool(
    'get_hands',
    'Read both hands and their current state.',
    {},
    (session) => session.getHands(),
    true
  );
  sessionTool(
    'get_screenshot',
    'Capture the current view as an image. Optionally save it to out. Set overlayOnCamera=false for a render without the device-camera overlay.',
    {
      options: z
        .strictObject({overlayOnCamera: z.boolean().optional()})
        .optional(),
      out: s.text.optional(),
    },
    async (session, {options, out}) => {
      const image = String(await session.getScreenshot(options));
      return {image, ...(out ? {out: await saveImage(out, image)} : {})};
    }
  );
  sessionTool(
    'get_scene_context',
    'Read selected scene products: semantic tree, visible objects, and/or set-of-mark image. Select at least one.',
    {options: s.sceneOptions},
    (session, {options}) => session.getSceneContext(options),
    true
  );
  sessionTool(
    'get_devtools_context',
    'Read developer locations, tags, state, spatial information, and/or view information.',
    {options: s.devtoolsOptions},
    (session, {options}) => session.getDevtoolsContext(options),
    true
  );
  sessionTool(
    'get_simulator_state',
    'Read simulator state.',
    {},
    (session) => session.getSimulatorState(),
    true
  );
  sessionTool(
    'get_preset_location',
    'Resolve a named developer location to world coordinates.',
    {name: s.text},
    (session, {name}) => session.getPresetLocation(name),
    true
  );
  sessionTool(
    'find_by_tag',
    'Find objects with a developer tag. Use returned IDs in {tag,id} targets when the tag is ambiguous.',
    {tag: s.text},
    (session, {tag}) => session.objects.findByTag(tag),
    true
  );
  sessionTool(
    'inspect',
    'Inspect an object, including identity, transforms, visibility, and hierarchy.',
    {target: s.target},
    (session, {target}) => session.objects.inspect(target),
    true
  );
  sessionTool(
    'inspect_scene',
    'Inspect the full scene hierarchy.',
    {},
    (session) => session.observe('inspectScene'),
    true
  );
  sessionTool(
    'get_diagnostics',
    'Read captured browser console entries, page errors, and network errors.',
    {},
    (session) => session.diagnostics,
    true
  );
  sessionTool(
    'save_set_of_mark',
    'Capture a set-of-mark image and metadata, save the image, and return both.',
    {out: s.text},
    async (session, {out}) => {
      const result = await session.getSceneContext({setOfMark: true});
      const marked = result.setOfMark as {image?: unknown} | undefined;
      if (typeof marked?.image !== 'string')
        throw new Error('Scene context did not return a set-of-mark image.');
      return {...result, out: await saveImage(out, marked.image)};
    }
  );

  sessionTool(
    'navigate_to',
    'Move the viewer to a target, respecting the navmesh when enabled.',
    {target: s.target},
    (session, {target}) => session.navigateTo(target)
  );
  sessionTool(
    'teleport_to',
    'Teleport the viewer to a target.',
    {
      target: s.target,
      options: z
        .strictObject({
          distance: z.number().nonnegative().optional(),
          faceTarget: z.boolean().optional(),
          snapToGround: z.boolean().optional(),
        })
        .optional(),
    },
    (session, {target, options}) => session.teleportTo(target, options)
  );
  sessionTool(
    'move',
    'Move relative to the view in meters: right, up, forward.',
    {motion: s.motion},
    (session, {motion}) => session.move(motion)
  );
  sessionTool(
    'rotate',
    'Rotate by relative YXZ Euler degrees: positive pitch up, yaw left, roll counterclockwise.',
    {rotation: s.rotation},
    (session, {rotation}) => session.rotate(rotation)
  );
  sessionTool(
    'look_at_target',
    'Rotate the viewer to look at a target.',
    {target: s.target, options: s.angularOptions.optional()},
    (session, {target, options}) => session.lookAtTarget(target, options)
  );
  sessionTool(
    'move_hand',
    'Move a hand relative to the view in meters. Held selection supports dragging.',
    {hand: s.hand, motion: s.motion},
    (session, {hand, motion}) => session.moveHand(hand, motion)
  );
  sessionTool(
    'teleport_hand',
    'Teleport a hand to a target.',
    {
      hand: s.hand,
      target: s.target,
      options: z.strictObject({anchor: s.anchor.optional()}).optional(),
    },
    (session, {hand, target, options}) =>
      session.teleportHand(hand, target, options)
  );
  sessionTool(
    'rotate_hand',
    'Rotate a hand by relative YXZ Euler degrees: positive pitch up, yaw left, roll counterclockwise.',
    {hand: s.hand, rotation: s.rotation},
    (session, {hand, rotation}) => session.rotateHand(hand, rotation)
  );
  sessionTool(
    'gesture',
    'Apply a named hand pose.',
    {hand: s.hand, pose: s.pose},
    (session, {hand, pose}) => session.gesture(hand, pose)
  );
  sessionTool(
    'set_hand_pose',
    'Set sparse hand joint rotations as [x,y,z] Euler radians.',
    {hand: s.hand, rotations: s.rotations},
    (session, {hand, rotations}) => session.setHandPose(hand, rotations)
  );
  sessionTool(
    'point_to',
    'Aim a hand ray at a target; does not move the fingertip. Follow with click to select.',
    {
      hand: s.hand.optional(),
      target: s.target.optional(),
      options: s.angularOptions.optional(),
    },
    (session, {hand, target, options}) => session.pointTo(hand, target, options)
  );
  sessionTool(
    'reach_to',
    'Move the index fingertip (or palm anchor) to a target without aiming the ray. For dragging, start_select, reach_to, then end_select.',
    {
      hand: s.hand.optional(),
      target: s.target.optional(),
      options: s.linearOptions.optional(),
    },
    (session, {hand, target, options}) => session.reachTo(hand, target, options)
  );
  sessionTool(
    'start_select',
    'Begin holding selection with a hand (default right).',
    {hand: s.hand.optional()},
    (session, {hand}) => session.startSelect(hand)
  );
  sessionTool(
    'end_select',
    'Release held selection with a hand (default right).',
    {hand: s.hand.optional()},
    (session, {hand}) => session.endSelect(hand)
  );
  sessionTool(
    'click',
    'Click with a hand at its current target (default right).',
    {
      hand: s.hand.optional(),
      options: z
        .strictObject({durationMs: z.number().positive().optional()})
        .optional(),
    },
    (session, {hand, options}) => session.click(hand, options)
  );
  sessionTool(
    'ray_click',
    'Point and click at a target as one queued operation.',
    {hand: s.hand, target: s.target},
    (session, {hand, target}) => session.rayClick(hand, target)
  );
  sessionTool(
    'apply_control',
    'Apply simulator control state using the embodied-control schema.',
    {control: s.control},
    (session, {control}) => session.applyControl(control)
  );
  sessionTool(
    'step_control',
    'Apply simulator control for a duration in milliseconds.',
    {
      control: s.control.optional(),
      durationMs: z.number().positive().optional(),
    },
    (session, {control, durationMs}) =>
      session.stepControl({control, durationMs})
  );
  sessionTool(
    'wait',
    'Advance the app for a positive duration in milliseconds.',
    {durationMs: z.number().positive()},
    (session, {durationMs}) => session.wait(durationMs)
  );
  sessionTool(
    'step_frame',
    'Advance a positive number of simulation frames (default one).',
    {frames: z.number().int().positive().optional()},
    (session, {frames}) => session.stepFrame(frames)
  );
  sessionTool(
    'inject_audio',
    'Inject a local WAV file or synthesized speech into the app microphone.',
    {
      input: z.union([
        z.strictObject({file: s.text}),
        z.strictObject({text: s.text.max(500)}),
      ]),
    },
    (session, {input}) => session.injectAudio(input)
  );
  sessionTool(
    'wait_for_audio_consumer',
    'Wait until the app is consuming microphone audio.',
    {
      options: z
        .strictObject({timeoutMs: z.number().positive().optional()})
        .optional(),
    },
    (session, {options}) => session.waitForAudioConsumer(options)
  );

  sessionTool(
    'add_simulator_objects',
    'Add simulator models from asset URLs, local glTF/GLB files, or serialized Three.js objects.',
    {definitions: z.array(s.simulatorObject)},
    (session, {definitions}) =>
      session.simulator.addObjects(s.materializeObjects(definitions))
  );
  sessionTool(
    'update_simulator_objects',
    'Update simulator object transforms, visibility, labels, data, or physics.',
    {updates: z.array(s.objectUpdate)},
    (session, {updates}) => session.simulator.updateObjects(updates)
  );
  sessionTool(
    'remove_simulator_objects',
    'Remove simulator objects by ID.',
    {ids: z.array(s.text)},
    (session, {ids}) => session.simulator.removeObjects(ids)
  );
  sessionTool(
    'clear_simulator_objects',
    'Remove all devtools-created simulator objects.',
    {},
    (session) => session.simulator.clearObjects()
  );
  sessionTool(
    'get_simulator_objects',
    'List simulator objects, optionally restricted to IDs.',
    {ids: z.array(s.text).optional()},
    (session, {ids}) => session.simulator.getObjects(ids),
    true
  );

  tool(
    'visualize',
    'Render a UI module, model module, or hand pose without opening an XR session. Returns an image and warnings. Module input accepts path or source. Hand joint rotations are radians. Optional out saves the PNG.',
    s.preview,
    async ({request, out, size, background}) => {
      const directory = out
        ? undefined
        : await mkdtemp(path.join(tmpdir(), 'xrblocks-mcp-preview-'));
      try {
        const result = await visualize({
          ...request,
          out: out ?? path.join(directory!, 'preview.png'),
          size,
          background,
          signal,
        });
        const bytes = await readFile(result.out);
        return {
          image: `data:image/png;base64,${bytes.toString('base64')}`,
          warnings: result.warnings,
          ...(out ? {out: result.out} : {}),
        };
      } finally {
        if (directory) await rm(directory, {recursive: true, force: true});
      }
    }
  );
  return server;
}
