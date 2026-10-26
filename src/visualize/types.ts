import type {
  HandPoseRotations,
  NamedHandPose,
  PhysicalHand,
} from '../session/types.js';

export type VisualizeKind = 'ui' | 'model' | 'hand';
export type ViewPreset = 'inspection-4' | 'turntable-4' | 'front';

export type PreviewInput = {path: string} | {source: string};

type VisualizeRequestBase = {
  out: string;
  size?: string;
  background?: string;
  assetsDir?: string;
  signal?: AbortSignal;
};

export type UIVisualizeRequest = VisualizeRequestBase & {
  kind: 'ui';
  input: PreviewInput;
  xrblocksRoot?: string;
};

export type ModelVisualizeRequest = VisualizeRequestBase & {
  kind: 'model';
  input: PreviewInput;
  views?: ViewPreset;
};

export type HandPreview = {
  pose?: NamedHandPose;
  rotations?: HandPoseRotations;
  hand?: PhysicalHand | 'both';
};

export type HandVisualizeRequest = VisualizeRequestBase &
  HandPreview & {
    kind: 'hand';
    views?: ViewPreset;
    xrblocksRoot?: string;
  };

export type VisualizeRequest =
  UIVisualizeRequest | ModelVisualizeRequest | HandVisualizeRequest;

export type VisualizeResult = {
  out: string;
  warnings: string[];
};

export type NormalizedPreviewInput = {
  modulePath: string;
  assetsDir: string;
  cleanup?: () => Promise<void>;
};
