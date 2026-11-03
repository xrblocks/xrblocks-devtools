import * as THREE from 'three';
import preview from 'virtual:input';
import {nextFrame, start} from './runtime.js';

type Preview = (context: {THREE: typeof THREE}) => unknown | Promise<unknown>;
type Direction = [number, number, number];
type Renderer = InstanceType<typeof THREE.WebGLRenderer>;
type Scene = InstanceType<typeof THREE.Scene>;
type Object3D = InstanceType<typeof THREE.Object3D>;
type Bounds = InstanceType<typeof THREE.Box3>;

function startModel(preview: Preview) {
  start(async () => {
    const config = window.__xrblocksVisualizerConfig;
    const canvas = document.createElement('canvas');
    canvas.width = config.width;
    canvas.height = config.height;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: config.background === 'transparent',
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(config.width, config.height, false);
    renderer.setPixelRatio(1);
    if (config.background !== 'transparent')
      renderer.setClearColor(config.background, 1);
    window.__xrblocksVisualizer!.dispose = async () => renderer.dispose();

    const object = modelObject(await preview({THREE}));
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(3, 5, 4);
    scene.add(light, object);
    await nextFrame();
    renderViews(
      renderer,
      scene,
      object,
      config.views,
      config.width,
      config.height
    );
    return [];
  });
}

startModel(preview);

function modelObject(value: unknown): THREE.Object3D {
  if (value instanceof THREE.Object3D) return value;
  throw new Error('Model preview must return exactly one THREE.Object3D.');
}

function renderViews(
  renderer: Renderer,
  scene: Scene,
  object: Object3D,
  preset: string,
  width: number,
  height: number
) {
  const bounds = new THREE.Box3().expandByObject(object, true);
  if (bounds.isEmpty())
    throw new Error('Model preview has no computable bounds.');
  const views = viewDefinitions(preset);
  const columns = views.length === 1 ? 1 : 2;
  const rows = Math.ceil(views.length / columns);
  const cellWidth = Math.floor(width / columns);
  const cellHeight = Math.floor(height / rows);
  renderer.setScissorTest(true);
  for (let index = 0; index < views.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = height - (row + 1) * cellHeight;
    renderer.setViewport(x, y, cellWidth, cellHeight);
    renderer.setScissor(x, y, cellWidth, cellHeight);
    renderer.render(
      scene,
      cameraFor(bounds, views[index], cellWidth / cellHeight)
    );
  }
  renderer.setScissorTest(false);
}

function cameraFor(
  bounds: Bounds,
  direction: [number, number, number],
  aspect: number
) {
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(
    bounds.getSize(new THREE.Vector3()).length() / 2,
    0.1
  );
  const camera = new THREE.PerspectiveCamera(
    35,
    aspect,
    0.01,
    radius * 10 + 10
  );
  camera.position
    .copy(center)
    .add(
      new THREE.Vector3(...direction).normalize().multiplyScalar(radius * 3.3)
    );
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return camera;
}

function viewDefinitions(preset: string): Direction[] {
  if (preset === 'front') return [[0, 0, 1]];
  if (preset === 'turntable-4') {
    return [
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, -1],
      [-1, 0, 0],
    ];
  }
  return [
    [-1, 0.35, 1],
    [1, 0.35, 1],
    [0, 1, 0.001],
    [0, -1, 0.001],
  ];
}
