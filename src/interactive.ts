import repl from 'node:repl';
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {XRBlocksSession, type XRBlocksSessionConfig} from './session/index.js';
import type {JsonObject} from './types.js';

const sessionCommands = [
  ['getCamera', 'getCamera(options?)'],
  ['getHands', 'getHands()'],
  ['getScreenshot', 'getScreenshot(options?)'],
  [
    'getSceneContext',
    'getSceneContext({semanticTree?, visibleObjects?, setOfMark?})',
  ],
  [
    'getDevtoolsContext',
    'getDevtoolsContext({locations?, tags?, state?, spatial?, view?})',
  ],
  ['getSimulatorState', 'getSimulatorState()'],
  ['navigateTo', 'navigateTo(target)'],
  ['teleportTo', 'teleportTo(target, options?)'],
  ['stepControl', 'stepControl({durationMs?, control?})'],
  ['applyControl', 'applyControl(control?)'],
  [
    'move',
    'move({rightMeters?, upMeters?, forwardMeters?, speedMetersPerSecond?})',
  ],
  [
    'rotate',
    'rotate({pitchDegrees?, yawDegrees?, rollDegrees?, speedDegreesPerSecond?})',
  ],
  ['moveHand', 'moveHand(hand, motion)'],
  ['teleportHand', 'teleportHand(hand, target)'],
  ['rotateHand', 'rotateHand(hand, rotation)'],
  ['gesture', 'gesture(hand, pose)'],
  ['setHandPose', 'setHandPose(hand, rotations)'],
  ['startSelect', 'startSelect(hand?)'],
  ['endSelect', 'endSelect(hand?)'],
  ['lookAtTarget', 'lookAtTarget(target, options?)'],
  ['pointTo', 'pointTo(hand?, target?, options?)'],
  ['reachTo', 'reachTo(hand?, target?, options?)'],
  ['click', 'click(hand?, options?)'],
  ['wait', 'wait(durationMs)'],
  ['stepFrame', 'stepFrame(frames?)'],
  ['injectAudio', 'injectAudio({file} | {text})'],
] as const satisfies readonly (readonly [keyof XRBlocksSession, string])[];

const helperUsages = [
  'findByTag(tag)',
  'inspect(target)',
  'inspectScene()',
  'addSimulatorObjects(definitions)',
  'updateSimulatorObjects(updates)',
  'removeSimulatorObjects(ids)',
  'clearSimulatorObjects()',
  'getSimulatorObjects(ids?)',
  'saveScreenshot(path, options?)',
  'saveSetOfMark(path)',
  'diagnostics()',
];

export async function runInteractive(config: XRBlocksSessionConfig) {
  const session = await XRBlocksSession.open(config);
  console.log(`Session: ${session.info?.url}`);
  console.log('Call functions directly. Exit with .exit or Ctrl-D.');

  const server = repl.start({prompt: 'xrblocks> ', ignoreUndefined: true});
  const waitForCommands = awaitReplPromises(server);
  installInteractiveContext(server, session);
  const onAbort = () => server.close();
  config.signal?.addEventListener('abort', onAbort, {once: true});

  try {
    if (config.signal?.aborted) server.close();
    await new Promise<void>((resolve) => server.once('exit', resolve));
  } finally {
    config.signal?.removeEventListener('abort', onAbort);
    server.close();
    await waitForCommands();
    await session.close();
  }
}

/** @internal */
export function installInteractiveContext(
  server: Pick<repl.REPLServer, 'context'>,
  session: XRBlocksSession
) {
  server.context.session = session;
  for (const [name] of sessionCommands) {
    const method = session[name] as (...args: never[]) => unknown;
    server.context[name] = method.bind(session);
  }
  server.context.objects = session.objects;
  server.context.findByTag = session.objects?.findByTag;
  server.context.inspect = session.objects?.inspect;
  server.context.simulator = session.simulator;
  server.context.addSimulatorObjects = session.simulator?.addObjects;
  server.context.updateSimulatorObjects = session.simulator?.updateObjects;
  server.context.removeSimulatorObjects = session.simulator?.removeObjects;
  server.context.clearSimulatorObjects = session.simulator?.clearObjects;
  server.context.getSimulatorObjects = session.simulator?.getObjects;
  server.context.inspectScene = () => session.observe('inspectScene');
  server.context.diagnostics = () => session.diagnostics;
  server.context.saveScreenshot = async (
    outputPath: string,
    options: JsonObject = {}
  ) => {
    const out = path.resolve(outputPath);
    await writeDataUrl(out, String(await session.getScreenshot(options)));
    return {out};
  };
  server.context.saveSetOfMark = async (outputPath: string) => {
    const result = await session.getSceneContext({setOfMark: true});
    const setOfMark = result.setOfMark;
    if (
      typeof setOfMark !== 'object' ||
      setOfMark === null ||
      Array.isArray(setOfMark) ||
      typeof (setOfMark as JsonObject).image !== 'string'
    ) {
      throw new Error('Set-of-Mark context did not include an image.');
    }
    const {image, ...metadata} = setOfMark as JsonObject;
    const out = path.resolve(outputPath);
    await writeDataUrl(out, String(image));
    return {...metadata, out};
  };
}

export function interactiveHelpText() {
  return [
    'REPL functions:',
    ...sessionCommands.map(([, usage]) => `  ${usage}`),
    ...helperUsages.map((usage) => `  ${usage}`),
    '',
    'Targets: exact scene/context name, [x, y, z], or {tag: "name"}.',
    'Exit: .exit or Ctrl-D.',
  ].join('\n');
}

function awaitReplPromises(server: repl.REPLServer) {
  const active = new Set<Promise<unknown>>();
  const evaluate = server.eval;
  const evaluateAndWait: repl.REPLEval = function (
    command,
    context,
    file,
    callback
  ) {
    evaluate.call(this, command, context, file, (error, result) => {
      if (error) {
        callback(error, result);
        return;
      }
      const pending = Promise.resolve(result);
      active.add(pending);
      void pending
        .then(
          (value) => callback(null, value),
          (reason) =>
            callback(
              reason instanceof Error ? reason : new Error(String(reason)),
              undefined
            )
        )
        .finally(() => active.delete(pending));
    });
  };
  (server as unknown as {eval: repl.REPLEval}).eval = evaluateAndWait;
  return async () => {
    while (active.size > 0) await Promise.allSettled(active);
  };
}

async function writeDataUrl(filePath: string, dataUrl: string) {
  const match = /^data:[^;]+;base64,(.*)$/.exec(dataUrl);
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, Buffer.from(match?.[1] ?? dataUrl, 'base64'));
}
