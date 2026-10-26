async function getScreenshot(args = {}) {
  const core = getCore();
  if (args.overlayOnCamera && !core.deviceCamera?.loaded) {
    throw new Error('Camera screenshot unavailable: the device camera is not loaded.');
  }
  if (core.screenshotSynthesizer?.getScreenshot) {
    const promise = core.screenshotSynthesizer.getScreenshot(
      !!args.overlayOnCamera
    );
    core.stepFrame(0);
    return promise;
  }
  const canvas = core.renderer?.domElement || document.querySelector('canvas');
  if (!canvas?.toDataURL) throw new Error('No screenshot source canvas found.');
  return canvas.toDataURL('image/png');
}
