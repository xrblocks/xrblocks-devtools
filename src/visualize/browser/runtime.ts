import type {HandPreview} from '../types.js';

export type PreviewConfig = {
  hand?: HandPreview;
  width: number;
  height: number;
  background: string;
  views: 'inspection-4' | 'turntable-4' | 'front';
};

declare global {
  interface Window {
    __xrblocksVisualizerConfig: PreviewConfig;
    __xrblocksVisualizer?: {
      ready?: boolean;
      error?: string;
      warnings?: string[];
      dispose?: () => Promise<void>;
    };
  }
}

export function start(run: () => Promise<string[]>) {
  window.__xrblocksVisualizer = {ready: false, warnings: []};
  void run().then(
    (warnings) => {
      window.__xrblocksVisualizer!.warnings = warnings;
      window.__xrblocksVisualizer!.ready = true;
    },
    (error: unknown) => {
      console.error(error);
      window.__xrblocksVisualizer!.error =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
    }
  );
}

export function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
