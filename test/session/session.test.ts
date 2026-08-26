import {describe, expect, it, vi} from 'vitest';
import {XRBlocksSession} from '../../src/session/session.js';
import type {
  OpenSessionRuntime,
  SessionRuntimePort,
} from '../../src/session/runtime.js';

describe('Session interface', () => {
  it('opens and closes through one runtime seam', async () => {
    const runtime = fakeRuntime();
    const openRuntime = vi.fn(async () => runtime);
    const session = new XRBlocksSession(
      {
        appDir: '/app',
        recording: {mode: 'checkpoints', out: '/artifacts/run.mp4'},
      },
      openRuntime
    );

    await session.start();
    const result = await session.close();

    expect(openRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {appDir: '/app'},
        recording: {mode: 'checkpoints', out: '/artifacts/run.mp4'},
      })
    );
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(result.diagnostics).toBe(runtime.diagnostics);
    await session.close();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('maps semantic actions to runtime operations', async () => {
    const runtime = fakeRuntime();
    const session = await openWith(runtime);

    await session.getCamera({screenshot: true, overlayOnCamera: false});
    await session.move({forwardMeters: 2, speedMetersPerSecond: 1});
    await session.pointTo('left', 'Target', {speedDegreesPerSecond: 90});
    await session.click('right');

    expect(runtime.invoke).toHaveBeenCalledWith('observe', 'getCamera', {
      screenshot: true,
      overlayOnCamera: false,
    });
    expect(runtime.perform).toHaveBeenCalledWith(
      'move',
      {forwardMeters: 2, speedMetersPerSecond: 1},
      'stepControl',
      {durationMs: 2_000, control: {locomotion: {move: [0, 0, -2]}}}
    );
    expect(runtime.perform).toHaveBeenCalledWith(
      'pointTo',
      {hand: 'left', target: 'Target', speedDegreesPerSecond: 90},
      'pointTo',
      0,
      'Target',
      {velocity: Math.PI / 2}
    );
    expect(runtime.perform).toHaveBeenCalledWith(
      'click',
      {hand: 'right', options: undefined},
      'click',
      1,
      undefined
    );
    await session.close();
  });

  it('keeps object, simulator, and audio operations direct', async () => {
    const runtime = fakeRuntime();
    const session = await openWith(runtime);

    await session.objects.findByTag('box');
    await session.simulator.updateObjects([{id: 'box', position: [1, 2, 3]}]);
    await session.waitForAudioConsumer({timeoutMs: 2_000});
    await session.injectAudio({file: '/speech.wav'});

    expect(runtime.invoke).toHaveBeenCalledWith('findObjectsByTag', 'box');
    expect(runtime.invoke).toHaveBeenCalledWith('updateSimulatorObjects', [
      {id: 'box', position: [1, 2, 3]},
    ]);
    expect(runtime.injectAudio).toHaveBeenCalledWith({file: '/speech.wav'});
    expect(runtime.waitForAudioConsumer).toHaveBeenCalledWith({
      timeoutMs: 2_000,
    });
    await session.close();
  });
});

async function openWith(runtime: SessionRuntimePort) {
  const openRuntime: OpenSessionRuntime = async () => runtime;
  const session = new XRBlocksSession(
    {url: 'http://example.test'},
    openRuntime
  );
  await session.start();
  return session;
}

function fakeRuntime(): SessionRuntimePort {
  const diagnostics = {
    consoleEntries: [],
    pageErrors: [],
    networkErrors: [],
  };
  return {
    info: {
      url: 'http://example.test/?xrAutomation=1&debug=1',
    },
    diagnostics,
    invoke: vi.fn().mockResolvedValue({}),
    perform: vi.fn().mockResolvedValue({completed: true}),
    injectAudio: vi.fn().mockResolvedValue({completed: true}),
    waitForAudioConsumer: vi.fn().mockResolvedValue({
      activeConsumers: 1,
      injectionActive: false,
      contextState: 'running',
    }),
    close: vi.fn().mockResolvedValue({diagnostics}),
  } as SessionRuntimePort;
}
