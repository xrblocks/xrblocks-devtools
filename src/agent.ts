import {generateText, type LanguageModel, type ModelMessage} from 'ai';
import type {XRBlocksSession} from './session/index.js';
import type {JsonObject} from './types.js';
import {
  aiTimeoutMs,
  createAiModel,
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_MODEL,
} from './ai.js';
import {
  AgentActionError,
  executeAgentAction,
  type AgentToolProfile,
} from './session/actions.js';
import {
  captureAgentObservation,
  normalizeAgentObservations,
  type AgentObservationKind,
  type AgentObservationSelection,
} from './agent-observations.js';
import type {ActArtifacts} from './agent-artifacts.js';
import {
  agentToolResultMessage,
  buildAgentSystemInstruction,
  createAgentTools,
  initialAgentMessage,
  parseAgentToolCall,
  type AgentActionOutcome,
} from './agent-model.js';

const DEFAULT_OBSERVATION_DELAY_MS = 500;

export type ActEvent = JsonObject & {
  timestamp_ms: number;
  turn: number;
  type:
    | 'observation'
    | 'action'
    | 'action_error'
    | 'exit'
    | 'invalid_response'
    | 'model_error';
};

export type ActOptions = {
  context?: AgentObservationSelection;
  maxTurns?: number;
  model?: string;
  /** Retry limit for transient model errors. Defaults to 6. */
  maxRetries?: number;
  timeoutMs?: number;
  /** Time to let the app update before each post-action observation. */
  observationDelayMs?: number;
  toolProfile?: AgentToolProfile;
  signal?: AbortSignal;
  onEvent?: (event: ActEvent) => void;
};

export type ActExitPayload = {
  message: string;
  data?: JsonObject;
};

export type ActStatus = 'completed' | 'max_turns' | 'model_error' | 'aborted';

export type ActTrajectory = {
  schemaVersion: 1;
  instruction: string;
  configuration: {
    model: string;
    maxTurns: number;
    maxRetries: number;
    timeoutMs: number;
    observationDelayMs: number;
    toolProfile: AgentToolProfile;
    observations: AgentObservationKind[];
  };
  events: ActEvent[];
};

export type ActResult = {
  status: ActStatus;
  exit?: ActExitPayload;
  trajectory: ActTrajectory;
  usage: {
    turns: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  artifacts?: ActArtifacts;
};

type SessionActDependencies = {
  captureObservation?: typeof captureAgentObservation;
  executeAction?: (
    session: XRBlocksSession,
    profile: AgentToolProfile,
    name: string,
    args: JsonObject
  ) => unknown | Promise<unknown>;
  model?: LanguageModel;
  clock?: () => number;
};

export async function runSessionAct(
  session: XRBlocksSession,
  instruction: string,
  options: ActOptions = {},
  dependencies: SessionActDependencies = {}
): Promise<ActResult> {
  if (!instruction.trim())
    throw new Error('Agent instruction must not be empty.');

  const modelName = options.model?.trim() || DEFAULT_AI_MODEL;
  const maxTurns = integerOption(options.maxTurns ?? 30, 'maxTurns', 1);
  const maxRetries = integerOption(
    options.maxRetries ?? DEFAULT_AI_MAX_RETRIES,
    'maxRetries',
    0
  );
  const timeoutMs = aiTimeoutMs(options.timeoutMs);
  const observationDelayMs = finiteOption(
    options.observationDelayMs ?? DEFAULT_OBSERVATION_DELAY_MS,
    'observationDelayMs',
    0
  );
  const toolProfile = options.toolProfile ?? 'targeted';
  const observationKinds = normalizeAgentObservations(options.context);
  const tools = createAgentTools(toolProfile);
  const captureObservation =
    dependencies.captureObservation ?? captureAgentObservation;
  const executeAction = dependencies.executeAction ?? executeAgentAction;
  const clock = dependencies.clock ?? (() => performance.now());
  const startedAt = clock();
  const events: ActEvent[] = [];
  let turns = 0;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  const record = (event: ActEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };
  const finish = (status: ActStatus, exit?: ActExitPayload): ActResult => ({
    status,
    ...(exit ? {exit} : {}),
    trajectory: {
      schemaVersion: 1,
      instruction,
      configuration: {
        model: modelName,
        maxTurns,
        maxRetries,
        timeoutMs,
        observationDelayMs,
        toolProfile,
        observations: observationKinds,
      },
      events,
    },
    usage: {
      turns,
      durationMs: elapsedMs(clock, startedAt),
      ...(inputTokens !== undefined ? {inputTokens} : {}),
      ...(outputTokens !== undefined ? {outputTokens} : {}),
    },
  });
  const observe = () =>
    captureObservation({
      session,
      timestampMs: elapsedMs(clock, startedAt),
      kinds: observationKinds,
    });

  try {
    options.signal?.throwIfAborted();
    const model = dependencies.model ?? (await createAiModel(modelName));
    let observation = await observe();
    recordObservation(observation, 0, record);
    const messages: ModelMessage[] = [
      initialAgentMessage(instruction, observation),
    ];

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      options.signal?.throwIfAborted();
      turns = turn;
      let response: Awaited<ReturnType<typeof generateText>>;
      try {
        response = await generateText({
          model,
          instructions: buildAgentSystemInstruction(
            observationKinds,
            toolProfile
          ),
          messages,
          tools,
          toolChoice: 'required',
          maxRetries,
          timeout: timeoutMs,
          abortSignal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) return finish('aborted');
        record({
          timestamp_ms: elapsedMs(clock, startedAt),
          turn,
          type: 'model_error',
          result: {error: errorMessage(error)},
        });
        return finish('model_error');
      }
      inputTokens = addTokens(inputTokens, response.usage.inputTokens);
      outputTokens = addTokens(outputTokens, response.usage.outputTokens);

      const call = parseAgentToolCall(response.toolCalls, tools);
      if (!call) {
        record({
          timestamp_ms: elapsedMs(clock, startedAt),
          turn,
          type: 'invalid_response',
          result: {
            summary: `Agent model must return exactly one declared tool call; received ${response.toolCalls.length}.`,
          },
        });
        return finish('model_error');
      }
      if (call.name === 'exit') {
        const exit = exitPayload(call.args);
        if (!exit) {
          record({
            timestamp_ms: elapsedMs(clock, startedAt),
            turn,
            type: 'invalid_response',
            result: {summary: 'Agent exit tool input is invalid.'},
          });
          return finish('model_error');
        }
        record({
          timestamp_ms: elapsedMs(clock, startedAt),
          turn,
          type: 'exit',
          tool_call: call,
          result: exit,
        });
        return finish('completed', exit);
      }

      let action: AgentActionOutcome;
      try {
        const result = await executeAction(
          session,
          toolProfile,
          call.name,
          call.args
        );
        action = {ok: true, result: toJsonObject(result)};
        record({
          timestamp_ms: elapsedMs(clock, startedAt),
          turn,
          type: 'action',
          tool_call: call,
          tool_result: action.result,
        });
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!(error instanceof AgentActionError)) throw error;
        action = {ok: false, error: error.message};
        record({
          timestamp_ms: elapsedMs(clock, startedAt),
          turn,
          type: 'action_error',
          tool_call: call,
          result: {error: error.message},
        });
      }

      if (observationDelayMs > 0) await session.wait(observationDelayMs);
      observation = await observe();
      recordObservation(observation, turn, record);
      messages.push(
        ...response.responseMessages,
        agentToolResultMessage(
          response.toolCalls[0]!.toolCallId,
          call.name,
          action,
          observation
        )
      );
    }
    return finish('max_turns');
  } catch (error) {
    if (options.signal?.aborted) return finish('aborted');
    throw error;
  }
}

function recordObservation(
  observation: JsonObject,
  turn: number,
  record: (event: ActEvent) => void
) {
  record({
    timestamp_ms: Number(observation.timestamp_ms ?? 0),
    turn,
    type: 'observation',
    result: observation,
  });
}

function exitPayload(args: JsonObject): ActExitPayload | undefined {
  if (
    typeof args.message !== 'string' ||
    (args.data !== undefined && !isJsonObject(args.data))
  )
    return undefined;
  return {
    message: args.message,
    ...(isJsonObject(args.data) ? {data: args.data} : {}),
  };
}

function elapsedMs(clock: () => number, start: number) {
  return Math.max(0, Math.floor(clock() - start));
}

function integerOption(value: number, name: string, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${name} must be an integer of at least ${minimum}.`);
  return value;
}

function finiteOption(value: number, name: string, minimum: number) {
  if (!Number.isFinite(value) || value < minimum)
    throw new TypeError(`${name} must be at least ${minimum}.`);
  return value;
}

function addTokens(total: number | undefined, value: number | undefined) {
  return value === undefined ? total : (total ?? 0) + value;
}

function toJsonObject(value: unknown): JsonObject {
  if (value === undefined) return {};
  return isJsonObject(value) ? value : {value};
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
