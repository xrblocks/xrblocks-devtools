import type {PreviewConfig} from './browser/runtime.js';

export function previewHtml(options: PreviewConfig) {
  const bodyBackground =
    options.background === 'transparent' ? 'transparent' : options.background;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${bodyBackground}; }
      canvas { display: block; }
    </style>
    <script type="importmap">
      {
        "imports": {
          "three": "./runtime/three/build/three.module.js",
          "three/": "./runtime/three/",
          "three/addons/": "./runtime/three/examples/jsm/"
        }
      }
    </script>
  </head>
  <body>
    <script>
      window.__xrblocksVisualizerConfig = ${JSON.stringify(options)};
    </script>
    <script type="module" src="./entry.js"></script>
  </body>
</html>`;
}
