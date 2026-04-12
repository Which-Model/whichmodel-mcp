import { describe, it, expect } from 'vitest';
import { recommend } from '@which-model/whichmodel-core';
import { SAMPLE_MODELS } from '../fixtures/sample-models.js';
import type { RecommendationRequest } from '@which-model/whichmodel-core';

const FRESHNESS = '2026-04-01T00:00:00Z';

describe('recommend()', () => {
  it('returns a frontier model for high-complexity reasoning', () => {
    const request: RecommendationRequest = {
      task_type: 'reasoning',
      complexity: 'high',
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.quality_tier).toBe('frontier');
    expect(result.recommended.model_id).toBeTruthy();
    expect(result.data_freshness).toBe(FRESHNESS);
  });

  it('returns a budget-friendly model for low-complexity classification', () => {
    const request: RecommendationRequest = {
      task_type: 'classification',
      complexity: 'low',
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    // Should prefer cheaper models for simple classification
    expect(result.recommended.cost_estimate_usd).toBeLessThan(
      result.recommended.quality_tier === 'frontier' ? Infinity : 0.01,
    );
    expect(result.budget_model).not.toBeNull();
  });

  it('filters by tool_calling requirement', () => {
    const request: RecommendationRequest = {
      task_type: 'tool_calling',
      complexity: 'medium',
      requirements: { tool_calling: true },
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.capabilities.tool_calling).toBe(true);
  });

  it('filters by vision requirement', () => {
    const request: RecommendationRequest = {
      task_type: 'vision',
      complexity: 'medium',
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.capabilities.vision).toBe(true);
  });

  it('respects budget constraint', () => {
    const request: RecommendationRequest = {
      task_type: 'code_generation',
      complexity: 'high',
      estimated_input_tokens: 1000,
      estimated_output_tokens: 1000,
      budget_per_call: 0.001, // $0.001 budget
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.cost_estimate_usd).toBeLessThanOrEqual(0.001);
  });

  it('respects provider_include filter', () => {
    const request: RecommendationRequest = {
      task_type: 'chat',
      complexity: 'medium',
      requirements: { providers_include: ['anthropic'] },
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.provider).toBe('anthropic');
    if (result.alternative) {
      expect(result.alternative.provider).toBe('anthropic');
    }
  });

  it('respects provider_exclude filter', () => {
    const request: RecommendationRequest = {
      task_type: 'chat',
      complexity: 'medium',
      requirements: { providers_exclude: ['anthropic', 'openai'] },
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.provider).not.toBe('anthropic');
    expect(result.recommended.provider).not.toBe('openai');
  });

  it('returns alternative from different provider/tier when available', () => {
    const request: RecommendationRequest = {
      task_type: 'code_generation',
      complexity: 'medium',
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    if (result.alternative) {
      const diffProvider = result.alternative.provider !== result.recommended.provider;
      const diffTier = result.alternative.quality_tier !== result.recommended.quality_tier;
      expect(diffProvider || diffTier).toBe(true);
    }
  });

  it('returns budget_model that is cheaper than recommended', () => {
    const request: RecommendationRequest = {
      task_type: 'research',
      complexity: 'high',
      estimated_input_tokens: 2000,
      estimated_output_tokens: 3000,
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    if (result.budget_model && result.budget_model.model_id !== result.recommended.model_id) {
      expect(result.budget_model.cost_estimate_usd).toBeLessThanOrEqual(
        result.recommended.cost_estimate_usd,
      );
    }
  });

  it('uses default token estimates when none provided', () => {
    const request: RecommendationRequest = {
      task_type: 'summarisation',
      complexity: 'medium',
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    // Should produce a cost estimate even without user-provided tokens
    expect(result.recommended.cost_estimate_usd).toBeGreaterThan(0);
  });

  it('returns fallback when no models match', () => {
    const request: RecommendationRequest = {
      task_type: 'reasoning',
      complexity: 'high',
      budget_per_call: 0.0000001, // impossibly low
      estimated_input_tokens: 100000,
      estimated_output_tokens: 100000,
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.confidence).toBe('low');
  });

  it('includes reasoning text in recommendation', () => {
    const request: RecommendationRequest = {
      task_type: 'chat',
      complexity: 'low',
    };

    const result = recommend(SAMPLE_MODELS, request, FRESHNESS);

    expect(result.recommended.reasoning).toContain('chat');
    expect(result.recommended.reasoning.length).toBeGreaterThan(20);
  });
});
