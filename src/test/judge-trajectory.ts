import type {ActEvent, ActTrajectory} from '../agent.js';
import {
  buildTrajectoryJudgePrompt,
  TRAJECTORY_JUDGE_SYSTEM_INSTRUCTION,
} from '../agent-prompts.js';
import {agentActionDeclarations} from '../session/actions.js';
import {VerifierError} from './failure.js';
import {
  isJudgeVerdict,
  judgeWithSystemInstruction,
  type JudgeEvidence,
  type JudgeOptions,
  type JudgeVerdict,
} from './judge.js';

const MAX_TRAJECTORY_IMAGES = 6;
const MAX_TIMELINE_EVENTS = 120;
const MAX_VALUE_DEPTH = 4;
const MAX_COLLECTION_ITEMS = 20;
const MAX_STRING_LENGTH = 500;
const MAX_EVENT_JSON_LENGTH = 4_000;

const TRAJECTORY_VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {type: 'boolean'},
    reason: {type: 'string'},
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
} as const;

export interface JudgeTrajectoryOptions {
  requirement: string;
  trajectory: ActTrajectory;
  evidence?: readonly JudgeEvidence[];
  /** Custom schema. It must retain boolean verdict and string reason fields. */
  schema?: Record<string, unknown>;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type TrajectoryVerdict = JudgeVerdict;

type JudgeFunction = <T extends JudgeVerdict = JudgeVerdict>(
  options: JudgeOptions,
  systemInstruction: string
) => Promise<T>;

type JudgeTrajectoryDependencies = {
  judge?: JudgeFunction;
};

export function judgeTrajectory<
  T extends TrajectoryVerdict = TrajectoryVerdict,
>(options: JudgeTrajectoryOptions): Promise<T> {
  return judgeTrajectoryWithDependencies<T>(options);
}

/** @internal */
export async function judgeTrajectoryWithDependencies<
  T extends TrajectoryVerdict = TrajectoryVerdict,
>(
  options: JudgeTrajectoryOptions,
  dependencies: JudgeTrajectoryDependencies = {}
): Promise<T> {
  if (!options.requirement.trim())
    throw new VerifierError('Trajectory requirement must not be empty.');
  if (!Array.isArray(options.trajectory.events))
    throw new VerifierError('Trajectory events must be an array.');

  const evidence: JudgeEvidence[] = [
    {
      type: 'text',
      label: 'Ordered agent trajectory',
      text: summarizeTrajectory(options.trajectory.events),
    },
    ...trajectoryImageEvidence(options.trajectory.events),
    ...(options.evidence ?? []),
  ];

  try {
    const request: JudgeOptions = {
      prompt: buildTrajectoryJudgePrompt(
        options.requirement,
        options.trajectory.instruction
      ),
      evidence,
      schema: options.schema ?? TRAJECTORY_VERDICT_SCHEMA,
      model: options.model,
      maxRetries: options.maxRetries,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    };
    const systemInstruction = buildTrajectoryJudgeSystemInstruction(
      options.trajectory.configuration.toolProfile
    );
    const result = dependencies.judge
      ? await dependencies.judge<T>(request, systemInstruction)
      : await judgeWithSystemInstruction<T>(request, systemInstruction);
    if (!isJudgeVerdict(result))
      throw new VerifierError('Trajectory judge returned an invalid verdict.');
    return result;
  } catch (error) {
    if (error instanceof VerifierError) throw error;
    throw new VerifierError('Trajectory judge request failed.', {cause: error});
  }
}

function summarizeTrajectory(events: readonly ActEvent[]) {
  const lines = events.map(summarizeEvent);
  const bounded = boundTimeline(lines);
  return bounded.length === 0
    ? 'No trajectory events were recorded.'
    : bounded.join('\n');
}

function summarizeEvent(event: ActEvent) {
  const prefix = `Turn ${event.turn} at ${event.timestamp_ms} ms`;
  const call = asObject(event.tool_call);
  const name = typeof call?.name === 'string' ? call.name : 'unknown';
  const args = call?.args;
  if (event.type === 'observation') {
    const result = asObject(event.result);
    if (!result) return `${prefix}: observation ${boundedJson(event.result)}`;
    const {images: _images, ...observation} = result;
    return `${prefix}: observation ${boundedJson(observation)}`;
  }
  if (event.type === 'action')
    return `${prefix}: action ${name} ${boundedJson(args)}`;
  if (event.type === 'action_error')
    return `${prefix}: action_error ${name} ${boundedJson(args)}; ${errorSummary(event)}`;
  if (event.type === 'invalid_response')
    return `${prefix}: invalid_response; ${errorSummary(event)}`;
  if (event.type === 'model_error')
    return `${prefix}: model_error; ${errorSummary(event)}`;
  if (event.type === 'exit')
    return `${prefix}: exit ${boundedJson(event.result)}`;
  return `${prefix}: ${event.type}`;
}

function errorSummary(event: ActEvent) {
  const result = asObject(event.result);
  if (typeof result?.error === 'string') return result.error;
  if (typeof result?.summary === 'string') return result.summary;
  return boundedJson(event.result);
}

function boundTimeline(lines: readonly string[]) {
  if (lines.length <= MAX_TIMELINE_EVENTS) return [...lines];
  const startCount = Math.ceil(MAX_TIMELINE_EVENTS / 2);
  const endCount = Math.floor(MAX_TIMELINE_EVENTS / 2);
  return [
    ...lines.slice(0, startCount),
    `[${lines.length - MAX_TIMELINE_EVENTS} timeline events omitted]`,
    ...lines.slice(-endCount),
  ];
}

type TrajectoryImage = {
  kind: 'image' | 'som' | 'unknown';
  image: string;
  mimeType?: string;
};

type ObservationFrame = {
  eventIndex: number;
  turn: number;
  images: TrajectoryImage[];
};

type ActionTransition = {
  turn: number;
  name: string;
  before: ObservationFrame;
  after: ObservationFrame;
};

function trajectoryImageEvidence(events: readonly ActEvent[]): JudgeEvidence[] {
  const frames: ObservationFrame[] = [];
  for (const [eventIndex, event] of events.entries()) {
    if (event.type !== 'observation') continue;
    const images = observationImages(event);
    if (images.length > 0) frames.push({eventIndex, turn: event.turn, images});
  }
  if (frames.length === 0) return [];

  const transitions = actionTransitions(events, frames);
  const selectedFrames = selectEvidenceFrames(frames, transitions);
  const contexts = transitionContexts(transitions);
  const selectedImages: Array<{
    frame: ObservationFrame;
    image: TrajectoryImage;
  }> = [];

  for (const frame of selectedFrames) {
    const image =
      frame.images.find((candidate) => candidate.kind === 'image') ??
      frame.images[0];
    if (image) selectedImages.push({frame, image});
  }
  for (const frame of selectedFrames) {
    if (selectedImages.length >= MAX_TRAJECTORY_IMAGES) break;
    const primary = selectedImages.find((item) => item.frame === frame)?.image;
    const secondary = frame.images.find((image) => image !== primary);
    if (secondary) selectedImages.push({frame, image: secondary});
  }

  return selectedImages
    .sort((left, right) => left.frame.eventIndex - right.frame.eventIndex)
    .map(({frame, image}) => ({
      type: 'image',
      label: trajectoryImageLabel(frame, image, contexts.get(frame.eventIndex)),
      image: image.image,
      ...(image.mimeType ? {mimeType: image.mimeType} : {}),
    }));
}

function observationImages(event: ActEvent): TrajectoryImage[] {
  const candidates: TrajectoryImage[] = [];
  const result = asObject(event.result);
  if (!Array.isArray(result?.images)) return candidates;
  for (const value of result.images) {
    const image = asObject(value);
    if (typeof image?.dataUrl !== 'string' || image.dataUrl.trim().length === 0)
      continue;
    candidates.push({
      kind:
        image.kind === 'image' || image.kind === 'som' ? image.kind : 'unknown',
      image: image.dataUrl,
      ...(typeof image.mimeType === 'string' ? {mimeType: image.mimeType} : {}),
    });
  }
  return candidates;
}

function actionTransitions(
  events: readonly ActEvent[],
  frames: readonly ObservationFrame[]
) {
  const transitions: ActionTransition[] = [];
  for (const [eventIndex, event] of events.entries()) {
    if (event.type !== 'action') continue;
    const before = [...frames]
      .reverse()
      .find((frame) => frame.eventIndex < eventIndex);
    const after = frames.find((frame) => frame.eventIndex > eventIndex);
    if (!before || !after) continue;
    const call = asObject(event.tool_call);
    transitions.push({
      turn: event.turn,
      name: typeof call?.name === 'string' ? call.name : 'unknown',
      before,
      after,
    });
  }
  return transitions;
}

function selectEvidenceFrames(
  frames: readonly ObservationFrame[],
  transitions: readonly ActionTransition[]
) {
  const selected = new Map<number, ObservationFrame>();
  const transitionLimit = Math.floor(MAX_TRAJECTORY_IMAGES / 2);
  for (const transition of sampleEvenly(transitions, transitionLimit)) {
    selected.set(transition.before.eventIndex, transition.before);
    selected.set(transition.after.eventIndex, transition.after);
  }
  const remaining = frames.filter((frame) => !selected.has(frame.eventIndex));
  for (const frame of sampleEvenly(
    remaining,
    MAX_TRAJECTORY_IMAGES - selected.size
  ))
    selected.set(frame.eventIndex, frame);
  return [...selected.values()].sort(
    (left, right) => left.eventIndex - right.eventIndex
  );
}

function transitionContexts(transitions: readonly ActionTransition[]) {
  const contexts = new Map<number, string[]>();
  const add = (frame: ObservationFrame, context: string) => {
    const values = contexts.get(frame.eventIndex) ?? [];
    if (!values.includes(context)) values.push(context);
    contexts.set(frame.eventIndex, values);
  };
  for (const transition of transitions) {
    add(
      transition.before,
      `before turn ${transition.turn} action ${transition.name}`
    );
    add(
      transition.after,
      `after turn ${transition.turn} action ${transition.name}`
    );
  }
  return contexts;
}

function trajectoryImageLabel(
  frame: ObservationFrame,
  image: TrajectoryImage,
  contexts?: readonly string[]
) {
  const type =
    image.kind === 'image'
      ? 'raw image'
      : image.kind === 'som'
        ? 'Set-of-Mark image'
        : 'image';
  const relation = contexts?.length ? ` (${contexts.join('; ')})` : '';
  return `Trajectory turn ${frame.turn} observation${relation}: ${type}`;
}

function buildTrajectoryJudgeSystemInstruction(
  profile: ActTrajectory['configuration']['toolProfile']
) {
  const actions = agentActionDeclarations(profile)
    .map(({name, description}) => `- ${name}: ${description}`)
    .join('\n');
  return `${TRAJECTORY_JUDGE_SYSTEM_INSTRUCTION}

# Trusted action reference

The following descriptions define the available actor actions for this trajectory. Use them only to interpret inputs and time order. A sequence of actions can compose one interaction. Do not require one specific action sequence when another sequence can produce the required observable outcome.

${actions}

Set-of-Mark labels are temporary visual annotations for one observation. The same label can identify a different object in another observation, and one object can receive different labels. Use stable node IDs, exact names, transforms, or corroborated visual changes when object identity matters.`;
}

function sampleEvenly<T>(values: readonly T[], limit: number): T[] {
  if (limit <= 0 || values.length === 0) return [];
  if (values.length <= limit) return [...values];
  if (limit === 1) return [values[values.length - 1]!];
  return Array.from({length: limit}, (_, index) => {
    const sourceIndex = Math.round((index * (values.length - 1)) / (limit - 1));
    return values[sourceIndex]!;
  });
}

function boundedJson(value: unknown) {
  const text = JSON.stringify(boundValue(value, 0));
  if (text === undefined) return String(value);
  return text.length <= MAX_EVENT_JSON_LENGTH
    ? text
    : `${text.slice(0, MAX_EVENT_JSON_LENGTH)}...[event truncated]`;
}

function boundValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return '[image data omitted]';
    return value.length <= MAX_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (depth >= MAX_VALUE_DEPTH) return '[nested value omitted]';
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => boundValue(item, depth + 1));
    if (value.length > MAX_COLLECTION_ITEMS)
      items.push(`[${value.length - MAX_COLLECTION_ITEMS} items omitted]`);
    return items;
  }
  const object = asObject(value);
  if (!object) return String(value);
  const entries = Object.entries(object).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, MAX_COLLECTION_ITEMS))
    result[key] = boundValue(item, depth + 1);
  if (entries.length > MAX_COLLECTION_ITEMS)
    result['...'] =
      `${entries.length - MAX_COLLECTION_ITEMS} properties omitted`;
  return result;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
