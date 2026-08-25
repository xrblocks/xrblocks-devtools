import {describe, expect, it, vi} from 'vitest';
import {
  handIndex,
  resolveAppUrl,
  XRBlocksSession,
} from '../../src/session/session.js';
import type {
  SessionDependencies,
  SessionRuntimeAdapter,
  SessionVideoAdapter,
} from '../../src/session/session-dependencies.js';

describe('Session interface', () => {
  it('maps hand labels and resolves materialized app URLs', () => {
    expect(handIndex('left')).toBe(0);
    expect(handIndex('right')).toBe(1);
    expect(handIndex(undefined)).toBe(1);
    expect(() => handIndex(0 as never)).toThrow(
      'Hand must be "left" or "right"'
    );
    expect(resolveAppUrl('http://127.0.0.1:3000/')).toBe(
      'http://127.0.0.1:3000/app/?xrAutomation=1&debug=1'
    );
  });

  it('owns workspace, runtime, recording, and cleanup through one interface', async () => {
    const videoError = new Error('video finalization failed');
    const runtime = fakeRuntime({
      close: vi.fn().mockResolvedValue('/tmp/raw.webm'),
    });
    const video = fakeVideo({
      finish: vi.fn().mockRejectedValue(videoError),
    });
    const dependencies = fakeDependencies({runtime, video});
    const session = new XRBlocksSession(
      {
        appDir: '/app',
        recordVideo: {out: '/artifacts/run.mp4'},
      },
      dependencies
    );

    await session.start();
    await expect(session.close()).rejects.toBe(videoError);

    expect(dependencies.materializeWorkspace).toHaveBeenCalledOnce();
    expect(dependencies.serveWorkspace).toHaveBeenCalledWith('/workspace');
    expect(runtime.open).toHaveBeenCalledOnce();
    expect(video.finish).toHaveBeenCalledWith('/tmp/raw.webm', undefined);
    expect(dependencies.workspace.cleanup).toHaveBeenCalledOnce();
    expect(dependencies.server.close).toHaveBeenCalledOnce();
    await expect(session.close()).resolves.toBeUndefined();
  });

  it('retains diagnostics and shares concurrent cleanup work', async () => {
    let releaseRuntime!: () => void;
    const diagnostics = {
      consoleEntries: [{level: 'error', text: 'late failure'}],
      pageErrors: [],
      networkErrors: [],
    };
    const close = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          releaseRuntime = () => resolve('/tmp/raw.webm');
        })
    );
    const runtime = fakeRuntime({diagnostics, close});
    const session = new XRBlocksSession(
      {url: 'http://example.test'},
      fakeDependencies({runtime})
    );
    await session.start();

    const firstClose = session.close();
    const secondClose = session.close();
    expect(secondClose).toBe(firstClose);
    releaseRuntime();
    await firstClose;

    expect(close).toHaveBeenCalledOnce();
    expect(session.diagnostics).toBe(diagnostics);
  });

  it('normalizes observations and records high-level actions', async () => {
    const invoke = vi.fn().mockResolvedValue({completed: true});
    const runtime = fakeRuntime({invoke});
    const video = fakeVideo();
    const session = new XRBlocksSession(
      {
        url: 'http://example.test',
        recordVideo: {out: '/artifacts/run.mp4'},
      },
      fakeDependencies({runtime, video})
    );
    await session.start();

    await session.getCamera({screenshot: true, overlayOnCamera: false});
    await session.navigateTo([1, 2, 3]);
    await session.teleportTo('Target');
    await session.teleportHand('right', [0.2, 1.1, -0.8]);
    await session.pointTo('left', 'Target', {speedDegreesPerSecond: 90});
    await session.wait(1000);
    await session.stepFrame(2);

    expect(invoke).toHaveBeenCalledWith('observe', 'getCamera', {
      screenshot: true,
      overlayOnCamera: false,
    });
    expect(invoke).toHaveBeenCalledWith('pointTo', 0, 'Target', {
      velocity: Math.PI / 2,
    });
    expect(invoke).toHaveBeenCalledWith('reachTo', 1, [0.2, 1.1, -0.8]);
    expect(invoke).toHaveBeenCalledWith('wait', 1000);
    expect(invoke).toHaveBeenCalledWith('navigateTo', [1, 2, 3]);
    expect(video.recordAction).toHaveBeenCalledTimes(6);
    expect(
      vi.mocked(video.recordAction).mock.calls.map(([name]) => name)
    ).toEqual([
      'navigateTo',
      'teleportTo',
      'teleportHand',
      'pointTo',
      'wait',
      'stepFrame',
    ]);
    expect(() => session.wait(0)).toThrow(/positive finite number/);
    await session.close();
  });

  it('materializes audio inside Session and applies monitoring policy', async () => {
    const runtime = fakeRuntime();
    const dependencies = fakeDependencies({runtime});
    const session = new XRBlocksSession(
      {url: 'http://example.test', monitorAudio: true},
      dependencies
    );
    await session.start();

    await session.injectAudio({file: '/speech.wav'});

    expect(runtime.injectAudio).toHaveBeenCalledWith({
      source: 'file',
      base64: Buffer.from('wav').toString('base64'),
      monitor: true,
    });
    expect(dependencies.audioCleanup).toHaveBeenCalledOnce();
    await session.close();
  });

  it('translates semantic motion and hand poses into embodied-control steps', async () => {
    const invoke = vi.fn().mockResolvedValue({completed: true});
    const session = new XRBlocksSession(
      {url: 'http://example.test'},
      fakeDependencies({runtime: fakeRuntime({invoke})})
    );
    await session.start();

    await session.move({forwardMeters: 2, speedMetersPerSecond: 1});
    await session.rotate({yawDegrees: 90, speedDegreesPerSecond: 90});
    await session.moveHand('left', {
      rightMeters: 0.25,
      speedMetersPerSecond: 0.5,
    });
    await session.rotateHand('right', {
      rollDegrees: -45,
      speedDegreesPerSecond: 90,
    });
    await session.gesture('left', 'fist');
    await session.setHandPose('right', {wrist: [0.1, 0.2, 0.3]});

    expect(invoke.mock.calls.slice(0, 4)).toEqual([
      [
        'stepControl',
        {
          durationMs: 2_000,
          control: {locomotion: {move: [0, 0, -2]}},
        },
      ],
      [
        'stepControl',
        {
          durationMs: 1_000,
          control: {locomotion: {rotate: [0, 90, 0]}},
        },
      ],
      [
        'stepControl',
        {
          durationMs: 500,
          control: {leftHand: {move: [0.25, 0, 0]}},
        },
      ],
      [
        'stepControl',
        {
          durationMs: 500,
          control: {rightHand: {rotate: [0, 0, -45]}},
        },
      ],
    ]);
    expect(invoke).toHaveBeenCalledWith('stepControl', {
      durationMs: 500,
      control: {leftHand: {pose: 'fist'}},
    });
    expect(invoke).toHaveBeenCalledWith('stepControl', {
      durationMs: 500,
      control: {rightHand: {rotations: {wrist: [0.1, 0.2, 0.3]}}},
    });
    expect(() =>
      session.setHandPose('right', {
        unknown: [0, 0, 0],
      } as never)
    ).toThrow('Unknown hand-pose joint');
    await session.close();
  });

  it('manages simulator objects through session.simulator', async () => {
    const invoke = vi.fn().mockResolvedValue([{id: 'obj-1'}]);
    const session = new XRBlocksSession(
      {
        url: 'http://example.test',
        simulatorObjects: [{assetPath: './models/box.glb', tag: 'init-box'}],
      },
      fakeDependencies({runtime: fakeRuntime({invoke})})
    );
    await session.start();

    expect(invoke).toHaveBeenCalledWith('addSimulatorObjects', [
      expect.objectContaining({assetPath: './models/box.glb', tag: 'init-box'}),
    ]);

    await session.simulator.addObjects([
      {assetPath: './models/sphere.glb', tag: 'sphere-1'},
    ]);
    expect(invoke).toHaveBeenCalledWith('addSimulatorObjects', [
      expect.objectContaining({
        assetPath: './models/sphere.glb',
        tag: 'sphere-1',
      }),
    ]);

    await session.simulator.updateObjects([{id: 'obj-1', position: [1, 2, 3]}]);
    expect(invoke).toHaveBeenCalledWith('updateSimulatorObjects', [
      {id: 'obj-1', position: [1, 2, 3]},
    ]);

    await session.simulator.removeObjects(['obj-1']);
    expect(invoke).toHaveBeenCalledWith('removeSimulatorObjects', ['obj-1']);

    await session.simulator.clearObjects();
    expect(invoke).toHaveBeenCalledWith('clearSimulatorObjects');

    await session.simulator.getObjects(['obj-1']);
    expect(invoke).toHaveBeenCalledWith('getSimulatorObjects', ['obj-1']);

    await session.close();
  });
});

function fakeRuntime(
  overrides: Partial<SessionRuntimeAdapter> & {
    invoke?: ReturnType<typeof vi.fn>;
  } = {}
): SessionRuntimeAdapter {
  const invoke = overrides.invoke ?? vi.fn().mockResolvedValue({});
  return {
    diagnostics: {consoleEntries: [], pageErrors: [], networkErrors: []},
    open: vi.fn().mockResolvedValue({ready: true}),
    close: vi.fn().mockResolvedValue(undefined),
    invoke<T>(method: string, ...args: unknown[]) {
      return invoke(method, ...args) as Promise<T>;
    },
    injectAudio: vi.fn().mockResolvedValue({completed: true}),
    ...overrides,
  };
}

function fakeVideo(overrides: Partial<SessionVideoAdapter> = {}) {
  const recordAction = vi.fn(
    async <T>(_name: string, _metadata: unknown, action: () => Promise<T>) =>
      action()
  );
  return {
    rawDir: '/tmp/raw-video',
    markVideoStarted: vi.fn(),
    markSceneReady: vi.fn(),
    recordAction,
    finish: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as SessionVideoAdapter;
}

function fakeDependencies(
  options: {
    runtime?: SessionRuntimeAdapter;
    video?: SessionVideoAdapter;
  } = {}
) {
  const runtime = options.runtime ?? fakeRuntime();
  const workspace = {
    rootDir: '/workspace',
    appDir: '/workspace/app',
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
  const server = {
    url: 'http://127.0.0.1:3000/',
    close: vi.fn().mockResolvedValue(undefined),
  };
  const audioCleanup = vi.fn().mockResolvedValue(undefined);
  const dependencies: SessionDependencies & {
    workspace: typeof workspace;
    server: typeof server;
    audioCleanup: typeof audioCleanup;
  } = {
    materializeWorkspace: vi.fn().mockResolvedValue(workspace),
    serveWorkspace: vi.fn().mockResolvedValue(server),
    createRuntime: () => runtime,
    createVideoRecorder: vi.fn().mockResolvedValue(options.video),
    materializeAudio: vi.fn().mockResolvedValue({
      source: 'file',
      bytes: Buffer.from('wav'),
      cleanup: audioCleanup,
    }),
    workspace,
    server,
    audioCleanup,
  };
  return dependencies;
}
