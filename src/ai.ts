import type {LanguageModel} from 'ai';

export const DEFAULT_AI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_AI_MAX_RETRIES = 6;

const DEFAULT_AI_TIMEOUT_MS = 40_000;
const AI_PROVIDER_ENV = 'XRBLOCKS_DEV_TOOLS_AI_PROVIDER';
const GOOGLE_AI_API_KEY_ENV = 'GOOGLE_GENERATIVE_AI_API_KEY';
const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';

export class AiUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiUnavailableError';
  }
}

export async function createAiModel(model?: string): Promise<LanguageModel> {
  const modelName = model?.trim() || DEFAULT_AI_MODEL;
  const provider = process.env[AI_PROVIDER_ENV]?.trim() || 'google';

  if (provider === 'google') {
    mapGoogleAiApiKey();
    let google: typeof import('@ai-sdk/google').google;
    try {
      ({google} = await import('@ai-sdk/google'));
    } catch (cause) {
      throw new AiUnavailableError(
        'Google AI requires @ai-sdk/google. Install it with npm install @ai-sdk/google.',
        {cause}
      );
    }
    return google(modelName);
  }
  if (provider === 'vertex') {
    let vertex: typeof import('@ai-sdk/google-vertex').vertex;
    try {
      ({vertex} = await import('@ai-sdk/google-vertex'));
    } catch (cause) {
      throw new AiUnavailableError(
        'Vertex AI requires @ai-sdk/google-vertex. Install it with npm install @ai-sdk/google-vertex.',
        {cause}
      );
    }
    return vertex(modelName);
  }
  throw new Error(
    `${AI_PROVIDER_ENV} must be "google" or "vertex"; received "${provider}".`
  );
}

export function aiTimeoutMs(timeoutMs = DEFAULT_AI_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('AI timeoutMs must be a positive finite number.');
  return timeoutMs;
}

export function aiImagePart(image: string, mimeType?: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(image);
  const mediaType = mimeType ?? match?.[1] ?? 'image/png';
  const data = match?.[2] ?? image;
  if (!mediaType.startsWith('image/'))
    throw new TypeError('AI image MIME type must start with image/.');
  if (!data.trim()) throw new Error('AI image must not be empty.');
  return {
    type: 'file' as const,
    mediaType,
    data: {type: 'data' as const, data},
  };
}

function mapGoogleAiApiKey() {
  if (process.env[GOOGLE_AI_API_KEY_ENV]?.trim()) return;
  const compatibilityKey = process.env[GEMINI_API_KEY_ENV]?.trim();
  if (!compatibilityKey)
    throw new AiUnavailableError(`AI requires ${GOOGLE_AI_API_KEY_ENV}.`);
  process.env[GOOGLE_AI_API_KEY_ENV] = compatibilityKey;
}
