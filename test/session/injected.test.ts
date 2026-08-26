import {runInNewContext} from 'node:vm';
import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';

import {injectedHarnessSource} from '../../src/session/injected-source.js';
import type {XRBlocksSession} from '../../src/session/index.js';
import {
  expectNotVisible,
  expectRenderStateChanged,
  expectVisible,
} from '../../src/test/output-expectations.js';
import type {OutputSnapshot} from '../../src/test/output-types.js';

type InjectedWindow = {
  THREE?: typeof THREE;
  xb?: {core: unknown};
  xbReady?: Promise<void>;
  __xrblocksDevtoolsRuntime?: {
    findObjectsByTag(tag: string): Array<{id: string; tag?: string}>;
    inspectObject(input: {target: {tag: string}}): {
      tag?: string;
      state?: Record<string, unknown>;
      spatial?: {bounds: unknown};
      view?: {inFrustum: boolean};
    };
    getDevtoolsContext(options: object): {
      locations?: Record<string, unknown>;
      tags?: Array<Record<string, unknown>>;
      state?: Array<Record<string, unknown>>;
      spatial?: Array<Record<string, unknown>>;
    };
    inspectOutputVisibility(target: {tag: string; id?: string}): Promise<{
      exists: boolean;
      visible: boolean;
    }>;
    captureOutputSnapshot(options?: {tags?: string[]}): Promise<OutputSnapshot>;
    navigateTo(target: [number, number, number]): Promise<unknown>;
    init(options?: object): Promise<unknown>;
    addSimulatorObjects(
      definitions: object[]
    ): Promise<Array<Record<string, unknown>>>;
    updateSimulatorObjects(
      updates: object[]
    ): Promise<Array<Record<string, unknown>>>;
    removeSimulatorObjects(ids: string[]): {completed: boolean};
    clearSimulatorObjects(): {completed: boolean};
    getSimulatorObjects(ids?: string[]): Array<Record<string, unknown>>;
  };
};

async function installHarness(window: InjectedWindow) {
  runInNewContext(await injectedHarnessSource(), {
    window,
    location: {href: 'http://example.test/?debug=1&xrAutomation=1'},
    performance,
    setTimeout,
    clearTimeout,
    THREE,
  });
  return window.__xrblocksDevtoolsRuntime!;
}

function testWindow(
  scene: THREE.Scene,
  camera = new THREE.PerspectiveCamera()
) {
  camera.position.set(0, 0, 4);
  camera.updateMatrixWorld(true);
  return {
    xb: {
      core: {
        scene,
        camera,
        simulatorRunning: true,
        simulator: {options: {}},
      },
    },
    xbReady: Promise.resolve(),
  } satisfies InjectedWindow;
}

describe('injected Devtools runtime', () => {
  it('finds explicit tags and inspects declared state and spatial data', async () => {
    const scene = new THREE.Scene();
    const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    target.name = 'Delivery box';
    target.userData.xrblocksDevtools = {
      tag: 'delivery-box',
      state: {delivered: false, score: 2},
    };
    scene.add(target);
    const runtime = await installHarness(testWindow(scene));

    expect(runtime.findObjectsByTag('delivery-box')).toEqual([
      expect.objectContaining({id: target.uuid, tag: 'delivery-box'}),
    ]);
    expect(
      runtime.inspectObject({target: {tag: 'delivery-box'}})
    ).toMatchObject({
      tag: 'delivery-box',
      state: {delivered: false, score: 2},
    });
    expect(runtime.getDevtoolsContext({state: true, spatial: true})).toEqual({
      state: [
        expect.objectContaining({
          state: {delivered: false, score: 2},
        }),
      ],
      spatial: [
        expect.objectContaining({
          spatial: expect.objectContaining({hasRenderableContent: true}),
        }),
      ],
    });
    expect(runtime.getDevtoolsContext({tags: false, state: true})).toEqual({
      state: [expect.not.objectContaining({tag: expect.anything()})],
    });
  });

  it('requests all selected XR Blocks context products in one detection', async () => {
    const window = testWindow(new THREE.Scene());
    const calls: object[] = [];
    (window.xb!.core as {context?: unknown}).context = {
      scene: {
        async runContextDetection(options: object) {
          calls.push(options);
          return {semanticTree: {}, visibleObjects: {}, setOfMark: {}};
        },
      },
    };
    const runtime = await installHarness(window);

    await expect(
      runtime.observe('getSceneContext', {
        semanticTree: true,
        visibleObjects: true,
        setOfMark: true,
      })
    ).resolves.toEqual({semanticTree: {}, visibleObjects: {}, setOfMark: {}});
    expect(calls).toEqual([
      {semanticTree: true, visibleObjects: true, setOfMark: true},
    ]);
  });

  it('uses display state for visible and not-visible expectations', async () => {
    const scene = new THREE.Scene();
    const target = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    target.userData.xrblocksDevtools = {tag: 'result'};
    scene.add(target);
    const runtime = await installHarness(testWindow(scene));
    const session = {
      invoke(method: string, selector: {tag: string; id?: string}) {
        if (method !== 'inspectOutputVisibility') {
          throw new Error(`Unexpected runtime method: ${method}`);
        }
        return runtime.inspectOutputVisibility(selector);
      },
    } as unknown as XRBlocksSession;

    const snapshot = await runtime.captureOutputSnapshot({tags: ['result']});
    expect(snapshot).toEqual({
      outputs: [
        expect.objectContaining({
          id: target.uuid,
          render: expect.objectContaining({
            displayed: true,
          }),
        }),
      ],
      surfaces: [],
    });

    await expect(expectVisible(session, 'result')).resolves.toBeUndefined();
    await expect(expectNotVisible(session, 'result')).rejects.toThrow(
      'result is visible'
    );

    const blocker = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.2),
      new THREE.MeshBasicMaterial()
    );
    blocker.name = 'wall';
    blocker.position.z = 2;
    scene.add(blocker);

    await expect(expectVisible(session, 'result')).resolves.toBeUndefined();
    target.visible = false;
    const hiddenSnapshot = await runtime.captureOutputSnapshot({
      tags: ['result'],
    });
    expect(() =>
      expectRenderStateChanged(snapshot, hiddenSnapshot, 'result', [
        'visibility',
      ])
    ).not.toThrow();
    target.visible = true;
    target.material.transparent = true;
    target.material.opacity = 0;

    await expect(expectVisible(session, 'result')).rejects.toThrow(
      'no displayed geometry'
    );
    await expect(expectNotVisible(session, 'result')).resolves.toBeUndefined();
  });

  it('navigates through the XR Blocks simulator', async () => {
    const window = testWindow(new THREE.Scene());
    const core = window.xb!.core as {
      simulator: {moveUser: (position: THREE.Vector3) => void};
      stepFrame: () => void;
    };
    let destination: THREE.Vector3 | undefined;
    core.simulator.moveUser = (position) => {
      destination = position.clone();
    };
    let frames = 0;
    core.stepFrame = () => {
      frames += 1;
    };
    const runtime = await installHarness(window);

    await expect(runtime.navigateTo([2, 0, -3])).resolves.toEqual({
      completed: true,
      position: [0, 0, 4],
      constrained: false,
    });
    expect(destination?.toArray()).toEqual([2, 0, -3]);
    expect(frames).toBe(1);
  });

  it('enables the active environment navmesh before navigation', async () => {
    const window = testWindow(new THREE.Scene());
    const simulator = (window.xb!.core as {simulator: Record<string, unknown>})
      .simulator;
    const setEnvironment = vi.fn(async () => {
      simulator.userMovementConstrained = true;
    });
    simulator.options = {navMesh: {enabled: false}};
    simulator.activeEnvironment = {manifestPath: '/room.json'};
    simulator.userMovementConstrained = false;
    simulator.setEnvironment = setEnvironment;
    const runtime = await installHarness(window);

    await runtime.init({simulatorNavMesh: true});

    expect(simulator.options).toEqual({navMesh: {enabled: true}});
    expect(setEnvironment).toHaveBeenCalledWith('/room.json');
  });

  it('manages simulator objects and attaches Devtools tags and state', async () => {
    const scene = new THREE.Scene();
    const records = new Map<
      string,
      {id: string; object: THREE.Object3D; definition: Record<string, unknown>}
    >();
    const mockObjectsManager = {
      async addObjects(definitions: Array<Record<string, unknown>>) {
        return definitions.map((def, idx) => {
          const id = (def.id as string) || `obj-${idx + 1}`;
          const obj =
            (def.object as THREE.Object3D) ||
            new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
          obj.name = id;
          if (Array.isArray(def.position)) {
            obj.position.fromArray(def.position as [number, number, number]);
          }
          const record = {id, object: obj, definition: def};
          records.set(id, record);
          scene.add(obj);
          return record;
        });
      },
      async updateObjects(
        updates: Array<{id: string; position?: [number, number, number]}>
      ) {
        return updates.map((u) => {
          const record = records.get(u.id);
          if (record && u.position)
            record.object.position.fromArray(u.position);
          return record!;
        });
      },
      removeObjects(ids: string[]) {
        for (const id of ids) {
          const record = records.get(id);
          if (record) {
            scene.remove(record.object);
            records.delete(id);
          }
        }
      },
      clear() {
        for (const record of records.values()) {
          scene.remove(record.object);
        }
        records.clear();
      },
      get(ids?: string[]) {
        if (!ids) return Array.from(records.values());
        return ids.map((id) => records.get(id)).filter(Boolean);
      },
    };

    const window = testWindow(scene);
    (
      window.xb!.core as {simulator: Record<string, unknown>}
    ).simulator.objects = mockObjectsManager;
    window.THREE = THREE;
    const runtime = await installHarness(window);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const added = await runtime.addSimulatorObjects([
      {
        id: 'box-1',
        object: mesh,
        tag: 'target-box',
        state: {hit: false},
        position: [1, 2, 3],
      },
    ]);

    expect(added).toEqual([
      expect.objectContaining({
        id: 'box-1',
        tag: 'target-box',
        position: [1, 2, 3],
      }),
    ]);

    expect(runtime.findObjectsByTag('target-box')).toHaveLength(1);

    const updated = await runtime.updateSimulatorObjects([
      {id: 'box-1', position: [4, 5, 6]},
    ]);
    expect(updated[0].position).toEqual([4, 5, 6]);

    expect(runtime.getSimulatorObjects(['box-1'])).toHaveLength(1);

    runtime.removeSimulatorObjects(['box-1']);
    expect(runtime.getSimulatorObjects()).toHaveLength(0);
  });
});
