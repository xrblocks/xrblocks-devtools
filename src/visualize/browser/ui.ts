import * as xb from 'xrblocks';
import preview from 'virtual:preview';
import {nextFrame, start} from './runtime.js';

type Preview = (context: {xb: typeof xb}) => unknown | Promise<unknown>;

function startUi(preview: Preview) {
  start(async () => {
    const root = uiRoot(await preview({xb}));
    const canvas = document.createElement('canvas');
    canvas.width = window.__xrblocksVisualizerConfig.width;
    canvas.height = window.__xrblocksVisualizerConfig.height;
    document.body.appendChild(canvas);
    const stagedCard = stage(root);
    xb.add(root);

    const options = new xb.Options();
    options.canvas = canvas;
    options.enableAutomationMode({
      hideSimulatorUi: true,
      defaultMode: xb.SimulatorMode.USER,
      enableHands: false,
      enableCamera: false,
    });
    options.reticles.enabled = false;
    options.simulator.environments = [
      {name: 'Preview', manifestPath: 'data:application/json,%7B%7D'},
    ];
    options.simulator.activeEnvironmentIndex = 0;
    window.__xrblocksVisualizer!.dispose = () => xb.core.dispose();
    await xb.init(options);
    if (stagedCard) fitPreviewCamera(stagedCard);
    return await validationWarnings(root);
  });
}

startUi(preview);

function uiRoot(value: unknown): xb.UICard | xb.UIOverlay {
  if (value instanceof xb.UICard || value instanceof xb.UIOverlay) return value;
  throw new Error(
    'UI preview must return exactly one xb.UICard or xb.UIOverlay.'
  );
}

function stage(root: xb.UICard | xb.UIOverlay) {
  if (!(root instanceof xb.UICard)) return undefined;
  root.position.set(0, 1.5, -1);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  return root;
}

function fitPreviewCamera(root: xb.UICard) {
  const config = window.__xrblocksVisualizerConfig;
  const cardWidth = root.size.width;
  const cardHeight =
    root.size.height === 'auto'
      ? cardWidth / (config.width / config.height)
      : root.size.height;
  const verticalSizeAtOneMeter =
    Math.max(cardHeight, cardWidth / (config.width / config.height)) / 0.9;
  xb.camera.fov = (2 * Math.atan(verticalSizeAtOneMeter / 2) * 180) / Math.PI;
  xb.camera.updateProjectionMatrix();
}

async function validationWarnings(root: xb.UICard | xb.UIOverlay) {
  for (let frame = 0; frame < 180; frame += 1) {
    const report = xb.ui.validate(root);
    if (report.ready) {
      for (let frame = 0; frame < 6; frame += 1) await nextFrame();
      return xb.ui
        .validate(root)
        .issues.map(
          (issue) => `[${issue.severity}] ${issue.code}: ${issue.message}`
        );
    }
    await nextFrame();
  }
  throw new Error('XR Blocks UI did not complete layout within 180 frames.');
}
