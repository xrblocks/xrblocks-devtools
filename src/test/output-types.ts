import type {ObjectTransform, Vec3Tuple} from '../session/index.js';

export type OutputSelector = string | {tag: string; id?: string};

export type OutputBounds = {
  min: Vec3Tuple;
  max: Vec3Tuple;
  center: Vec3Tuple;
  size: Vec3Tuple;
};

export type OutputScreenBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type OutputMaterialSnapshot = {
  id: string;
  type: string;
  visible: boolean;
  color: string | number[] | null;
  emissive: string | number[] | null;
  emissiveIntensity: number | null;
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
  side: number | null;
  depthTest: boolean;
  depthWrite: boolean;
};

export type OutputRenderableSnapshot = {
  objectId: string;
  hasGeometry: boolean;
  geometry: string;
  materials: OutputMaterialSnapshot[];
};

export type OutputRecord = {
  id: string;
  tag: string;
  localTransform: ObjectTransform;
  worldTransform: ObjectTransform;
  bounds: OutputBounds | null;
  render: {
    hasRenderableGeometry: boolean;
    /** Scene Context reports that the output participates in rendering. */
    rendered: boolean;
    /** Scene Context reports that the output is in the camera frame. */
    inFrustum: boolean;
    /** Scene Context reports that the output is in line of sight. */
    unoccluded: boolean;
    screenBounds: OutputScreenBounds | null;
    screenCoverage: number;
    renderables: OutputRenderableSnapshot[];
  };
  text: string | null;
  path: {start: Vec3Tuple; end: Vec3Tuple} | null;
};

export type OutputSurfaceSnapshot = {
  id: string;
  label?: string;
  position: Vec3Tuple;
  normal: Vec3Tuple;
  bounds: OutputBounds | null;
};

export type OutputSnapshot = {
  outputs: OutputRecord[];
  surfaces: OutputSurfaceSnapshot[];
  visibility:
    | {available: true; snapshotId?: string; capturedAt?: number}
    | {available: false; error?: string};
};

export type OutputChangeField =
  | 'scale'
  | 'visibility'
  | 'color'
  | 'emissive'
  | 'opacity'
  | 'material'
  | 'geometry'
  | 'text';

export type OutputYawView = {
  yawDegrees: number;
  visibilityAvailable: boolean;
  rendered: boolean;
  inFrustum: boolean;
  unoccluded: boolean;
  error?: string;
};
