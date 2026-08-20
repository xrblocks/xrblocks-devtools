export {runTests, type AppBinding, type RunTestsOptions} from './run-tests.js';
export {VerifierError} from './failure.js';
export {
  judge,
  type JudgeEvidence,
  type JudgeOptions,
  type JudgeVerdict,
} from './judge.js';
export {
  judgeTrajectory,
  type JudgeTrajectoryOptions,
  type TrajectoryVerdict,
} from './judge-trajectory.js';
export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  it_session,
  vi,
  type XRBlocksIt,
  type XRBlocksTestOptions,
  type SessionTestFunction,
  type SessionTestOptions,
  type SessionTestRun,
  type BuiltInScene,
  type SceneVariant,
} from './authoring.js';
export type {
  AgentRunArtifact,
  EvaluationError,
  EvaluationResult,
  TestResult,
  TestRunResult,
  TestStatus,
} from './result.js';
