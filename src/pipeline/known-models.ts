import type { QualityTier } from '@which-model/whichmodel-core';

/**
 * Hand-curated quality tier assignments for well-known models.
 * This is the product — not a fallback. Price heuristics only handle unknowns.
 *
 * Updated: April 2026
 */
export const KNOWN_MODEL_TIERS: Record<string, QualityTier> = {
  // ── Anthropic ──
  'anthropic/claude-opus-4': 'frontier',
  'anthropic/claude-sonnet-4': 'frontier',
  'anthropic/claude-sonnet-4-5': 'frontier',
  'anthropic/claude-haiku-3.5': 'premium',
  'anthropic/claude-haiku-4': 'premium',

  // ── OpenAI ──
  'openai/gpt-4.1': 'frontier',
  'openai/gpt-4.1-mini': 'premium',
  'openai/gpt-4.1-nano': 'budget',
  'openai/o3': 'frontier',
  'openai/o3-mini': 'premium',
  'openai/o4-mini': 'premium',
  'openai/gpt-4o': 'frontier',
  'openai/gpt-4o-mini': 'premium',

  // ── Google ──
  'google/gemini-2.5-pro': 'frontier',
  'google/gemini-2.5-flash': 'premium',
  'google/gemini-2.0-flash': 'premium',
  'google/gemini-2.0-flash-lite': 'budget',
  'google/gemma-3-27b-it': 'standard',
  'google/gemma-3-12b-it': 'budget',

  // ── DeepSeek ──
  'deepseek/deepseek-chat-v3': 'premium',
  'deepseek/deepseek-r1': 'frontier',
  'deepseek/deepseek-chat': 'premium',

  // ── Meta ──
  'meta-llama/llama-4-maverick': 'premium',
  'meta-llama/llama-4-scout': 'standard',
  'meta-llama/llama-3.3-70b-instruct': 'standard',
  'meta-llama/llama-3.1-70b-instruct': 'standard',
  'meta-llama/llama-3.1-8b-instruct': 'budget',
  'meta-llama/llama-3.1-405b-instruct': 'premium',

  // ── Mistral ──
  'mistralai/mistral-large': 'premium',
  'mistralai/mistral-medium': 'standard',
  'mistralai/mistral-small': 'budget',
  'mistralai/codestral': 'standard',
  'mistralai/mistral-nemo': 'budget',

  // ── xAI ──
  'x-ai/grok-3': 'frontier',
  'x-ai/grok-3-mini': 'premium',
  'x-ai/grok-2': 'premium',

  // ── Cohere ──
  'cohere/command-r-plus': 'standard',
  'cohere/command-r': 'budget',
  'cohere/command-a': 'premium',

  // ── Qwen ──
  'qwen/qwen-2.5-72b-instruct': 'standard',
  'qwen/qwen-2.5-coder-32b-instruct': 'standard',
  'qwen/qwq-32b': 'standard',

  // ── Other ──
  'microsoft/phi-4': 'budget',
  'microsoft/phi-3-mini-128k-instruct': 'economy',
  'nvidia/llama-3.1-nemotron-70b-instruct': 'standard',
};

/**
 * Prefixes of providers whose models we want to include during seeding.
 * Models from unlisted providers are skipped.
 */
export const INCLUDED_PROVIDER_PREFIXES = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'meta-llama',
  'mistralai',
  'x-ai',
  'cohere',
  'qwen',
  'microsoft',
  'nvidia',
  'amazon',
];

/**
 * Fallback tier assignment based on per-token pricing.
 * Only used for models NOT in KNOWN_MODEL_TIERS.
 */
export function inferTierFromPricing(pricePerToken: number): QualityTier {
  if (pricePerToken === 0) return 'economy';
  if (pricePerToken >= 0.00001) return 'frontier';   // >= $10/M tokens
  if (pricePerToken >= 0.000003) return 'premium';    // >= $3/M tokens
  if (pricePerToken >= 0.0000005) return 'standard';  // >= $0.50/M tokens
  if (pricePerToken >= 0.0000001) return 'budget';    // >= $0.10/M tokens
  return 'economy';
}
