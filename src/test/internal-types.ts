import type {
  BrowserDiagnostics,
  PhysicalHand,
  RecordingArtifact,
} from '../session/index.js';
import type {SceneVariant} from './authoring.js';
import type {AgentRunArtifact} from './result.js';

export interface XRBlocksTestMeta {
  schemaVersion: 1;
  logicalId: string;
  name: string;
  kind: 'test' | 'session';
  required: boolean;
  runId: string;
  primaryHand?: PhysicalHand;
  secondaryHand?: PhysicalHand;
  scene?: SceneVariant;
  realTime?: boolean;
  recording?: RecordingArtifact;
  agentRuns?: AgentRunArtifact[];
  diagnostics?: BrowserDiagnostics;
}

export interface XRBlocksTestContext {
  appDir: string;
  xrblocksRoot?: string;
  entry?: string;
  artifactDir: string;
  sessionTimeoutMs?: number;
}

export type XRBlocksTestFailureKind = 'candidate' | 'verifier';
export type XRBlocksTestFailurePhase = 'session' | 'test' | 'cleanup';

declare module '@vitest/runner' {
  interface TaskMeta {
    xrblocksTest?: XRBlocksTestMeta;
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    xrblocksTest: XRBlocksTestContext;
  }
}
