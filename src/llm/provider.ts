import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { NautilusConfig } from '../config.js';

function resolveProviderKind(modelId: string): 'anthropic' | 'google' | 'unknown' {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith('claude-')) return 'anthropic';
  if (normalized.startsWith('gemini-') || normalized.startsWith('gemma-')) return 'google';
  return 'unknown';
}

export function resolveLanguageModel(config: NautilusConfig, modelId = config.defaultModel) {
  const kind = resolveProviderKind(modelId);

  if (kind === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Claude models.');
    }
    return createAnthropic({ apiKey: config.anthropicApiKey })(modelId);
  }

  if (kind === 'google') {
    if (!config.googleGenerativeAiApiKey) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini/Gemma models.');
    }
    return createGoogleGenerativeAI({ apiKey: config.googleGenerativeAiApiKey })(modelId);
  }

  throw new Error(
    `Unsupported DEFAULT_MODEL "${modelId}". Use a Claude model (claude-*) or Gemini/Gemma model (gemini-*/gemma-*).`,
  );
}
