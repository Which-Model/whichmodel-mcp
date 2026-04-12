import type { OpenRouterModel, Model, ModelCapabilities, QualityTier } from '@which-model/whichmodel-core';
import { KNOWN_MODEL_TIERS, inferTierFromPricing } from './known-models.js';

/**
 * Transform an OpenRouter API model into our internal Model shape.
 */
export function transformOpenRouterModel(raw: OpenRouterModel): Model {
  const provider = raw.id.split('/')[0] ?? 'unknown';
  const pricingPrompt = parseFloat(raw.pricing.prompt) || 0;
  const pricingCompletion = parseFloat(raw.pricing.completion) || 0;
  const pricingImage = raw.pricing.image ? parseFloat(raw.pricing.image) || null : null;
  const pricingRequest = raw.pricing.request ? parseFloat(raw.pricing.request) || null : null;

  const params = raw.supported_parameters ?? [];
  const modality = raw.architecture?.modality ?? 'text->text';

  const capabilities: ModelCapabilities = {
    tool_calling: params.includes('tools') || params.includes('tool_choice'),
    json_output: params.includes('response_format'),
    streaming: true, // virtually all models support streaming
    vision: modality.includes('image'),
  };

  const qualityTier = assignQualityTier(raw.id, pricingPrompt);

  return {
    model_id: raw.id,
    provider,
    display_name: raw.name,
    description: raw.description ?? null,
    context_length: raw.context_length,
    max_output_tokens: raw.top_provider?.max_completion_tokens ?? null,
    modality,
    pricing_prompt: pricingPrompt,
    pricing_completion: pricingCompletion,
    pricing_image: pricingImage,
    pricing_request: pricingRequest,
    capabilities,
    supported_parameters: params,
    quality_tier: qualityTier,
    quality_confidence: 'provisional',
    value_score: null, // computed later by the engine
    is_active: true,
    availability_status: 'active',
    deprecated_at: null,
    consecutive_missing_runs: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Assign quality tier: curated map first, price heuristic fallback.
 */
function assignQualityTier(modelId: string, pricePerToken: number): QualityTier {
  // Exact match in curated map
  if (KNOWN_MODEL_TIERS[modelId]) {
    return KNOWN_MODEL_TIERS[modelId];
  }

  // Try prefix match (handles versioned variants like "anthropic/claude-sonnet-4:beta")
  for (const [knownId, tier] of Object.entries(KNOWN_MODEL_TIERS)) {
    if (modelId.startsWith(knownId)) {
      return tier;
    }
  }

  return inferTierFromPricing(pricePerToken);
}
