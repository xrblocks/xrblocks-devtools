import type {ObjectTransform, Vec3Tuple} from '../session/index.js';

export type OutputSelector = string | {tag: string; id?: string};

export type OutputBounds = {
  min: Vec3Tuple;
  max: Vec3Tuple;
  center: Vec3Tuple;
  size: Vec3Tuple;
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
  vertexColors: boolean;
};

export type OutputVertexColorSnapshot = {
  count: number;
  averageRgb: Vec3Tuple;
  averageHslSaturation: number;
  minimumHslSaturation: number;
  maximumHslSaturation: number;
};

export type OutputRenderableSnapshot = {
  objectId: string;
  hasGeometry: boolean;
  geometry: string;
  vertexColors: OutputVertexColorSnapshot | null;
  materials: OutputMaterialSnapshot[];
};

export type OutputRecord = {
  id: string;
  tag: string;
  localTransform: ObjectTransform;
  worldTransform: ObjectTransform;
  bounds: OutputBounds | null;
  render: {
    displayed: boolean;
    renderables: OutputRenderableSnapshot[];
  };
  text: string | null;
  path: {start: Vec3Tuple; end: Vec3Tuple} | null;
};

export type OutputSurfaceSnapshot = {
  id: string;
  kind: 'plane' | 'mesh';
  label?: string;
  position: Vec3Tuple;
  normal?: Vec3Tuple;
  bounds: OutputBounds | null;
  distanceByOutputId?: Record<string, number>;
};

export type OutputSnapshot = {
  outputs: OutputRecord[];
  surfaces: OutputSurfaceSnapshot[];
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
