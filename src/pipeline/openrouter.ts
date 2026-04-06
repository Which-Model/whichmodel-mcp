import type { OpenRouterModel } from '../engine/types.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Fetch all models from the OpenRouter API.
 * This endpoint is free and requires no authentication.
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(OPENROUTER_API_URL, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'WhichModel-MCP/0.1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
  }

  const body = await response.json() as { data?: OpenRouterModel[] };

  if (!body.data || !Array.isArray(body.data)) {
    throw new Error('OpenRouter API returned unexpected shape: missing data array');
  }

  return body.data;
}
