import {randomUUID} from 'node:crypto';
import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserDiagnostics,
  PhysicalHand,
  RecordingArtifact,
} from '../session/index.js';
import type {ActStatus} from '../agent.js';
import type {SceneVariant} from './authoring.js';

export type TestStatus = 'passed' | 'failed' | 'blocked';

export interface AgentRunArtifact {
  status: ActStatus;
  trajectory: string;
  images: string[];
}

export interface TestRunResult {
  id: string;
  status: TestStatus;
  durationMs: number;
  primaryHand?: PhysicalHand;
  secondaryHand?: PhysicalHand;
  scene?: SceneVariant;
  realTime?: boolean;
  recording?: RecordingArtifact;
  agentRuns?: AgentRunArtifact[];
  message?: string;
  diagnostics?: BrowserDiagnostics;
}

export interface TestResult {
  id: string;
  name: string;
  kind: 'test' | 'session';
  required: boolean;
  status: TestStatus;
  runs: TestRunResult[];
}

export interface EvaluationError {
  kind: 'candidate' | 'verifier';
  phase: 'preflight' | 'collection' | 'session' | 'test' | 'cleanup';
  message: string;
  stack?: string;
}

export interface EvaluationResult {
  schemaVersion: 3;
  status: 'valid' | 'invalid';
  runnable: boolean;
  score: number | null;
  passedTests: number;
  totalTests: number;
  requiredGateFailed: boolean;
  tests: TestResult[];
  errors: EvaluationError[];
  provenance: {
    testRunnerVersion: string;
    app: Record<string, string>;
  };
  startedAt: string;
  finishedAt: string;
}

export async function writeResult(
  outputDir: string,
  result: EvaluationResult
): Promise<void> {
  const absoluteOutput = path.resolve(outputDir);
  await mkdir(absoluteOutput, {recursive: true});
  const destination = path.join(absoluteOutput, 'result.json');
  const temporary = path.join(
    absoluteOutput,
    `.result.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(temporary, destination);
  } finally {
    await rm(temporary, {force: true}).catch(() => undefined);
  }
}
