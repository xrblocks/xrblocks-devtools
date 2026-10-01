import {jsonSchema, tool, type ModelMessage, type ToolSet} from 'ai';
import type {JsonObject} from '../types.js';
import {aiImagePart} from './ai.js';
import {DEFAULT_SESSION_AGENT_PROMPT} from './prompts.js';
import {
  agentActionDeclarations,
  agentActionPrompt,
  type AgentToolProfile,
} from './actions.js';
import {
  agentObservationPrompt,
  type AgentObservationKind,
} from './observations.js';

export type AgentToolCall = {name: string; args: JsonObject};
export type AgentActionOutcome =
  {ok: true; result: JsonObject} | {ok: false; error: string};

type ObservationContent = Array<
  | {type: 'text'; text: string}
  | {
      type: 'file';
      mediaType: string;
      data: {type: 'data'; data: string};
    }
>;

export function createAgentTools(profile: AgentToolProfile): ToolSet {
  const outputSchema = jsonSchema<JsonObject>({
    type: 'object',
    additionalProperties: true,
  });
  const tools: ToolSet = {};
  for (const declaration of agentActionDeclarations(profile)) {
    tools[declaration.name] = tool({
      description: declaration.description,
      inputSchema: jsonSchema<JsonObject>(declaration.parameters),
      outputSchema,
    });
  }
  tools.exit = tool({
    description:
      'Stop the agent and return a message with optional structured data.',
    inputSchema: jsonSchema<{message: string; data?: JsonObject}>({
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'A concise final message for the caller.',
        },
        data: {
          type: 'object',
          description: 'Structured JSON data requested by the caller.',
        },
      },
      required: ['message'],
      additionalProperties: false,
    }),
    outputSchema,
  });
  return tools;
}

export function parseAgentToolCall(
  calls: Array<{
    toolName: string;
    input: unknown;
    invalid?: boolean;
  }>,
  tools: ToolSet
): AgentToolCall | undefined {
  if (calls.length !== 1) return undefined;
  const call = calls[0]!;
  if (!(call.toolName in tools) || call.invalid || !isJsonObject(call.input))
    return undefined;
  return {name: call.toolName, args: call.input};
}

export function initialAgentMessage(
  instruction: string,
  observation: JsonObject
): ModelMessage {
  return {
    role: 'user',
    content: observationContent(
      `Task:\n${instruction}\n\n${observationText(observation)}`,
      observation
    ),
  };
}

export function agentToolResultMessage(
  toolCallId: string,
  toolName: string,
  action: AgentActionOutcome,
  observation: JsonObject
): ModelMessage {
  const summary = action.ok
    ? `Action completed:\n${JSON.stringify(action.result)}`
    : `Action failed:\n${action.error}`;
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        toolName,
        output: {
          type: 'content',
          value: observationContent(
            `${summary}\n\n${observationText(observation)}`,
            observation
          ),
        },
      },
    ],
  };
}

export function buildAgentSystemInstruction(
  observationKinds: readonly AgentObservationKind[],
  toolProfile: AgentToolProfile
) {
  return [
    DEFAULT_SESSION_AGENT_PROMPT,
    agentActionPrompt(toolProfile),
    'Selected observations:',
    agentObservationPrompt(observationKinds),
  ]
    .filter(Boolean)
    .join('\n');
}

export function observationText(observation: JsonObject) {
  const {images: _images, ...state} = observation;
  return 'Latest state:\n' + JSON.stringify(state);
}

function observationContent(
  text: string,
  observation: JsonObject
): ObservationContent {
  const content: ObservationContent = [{type: 'text', text}];
  if (!Array.isArray(observation.images)) return content;
  for (const value of observation.images) {
    if (
      !isJsonObject(value) ||
      typeof value.label !== 'string' ||
      typeof value.dataUrl !== 'string'
    )
      continue;
    content.push(
      {type: 'text', text: `${value.label}:`},
      aiImagePart(value.dataUrl)
    );
  }
  return content;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
