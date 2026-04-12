import { describe, it, expect } from 'vitest';
import { computeValueScore } from '@which-model/whichmodel-core';
import { SAMPLE_MODELS } from '../fixtures/sample-models.js';

describe('computeValueScore()', () => {
  it('returns higher value for cheaper models at same tier', () => {
    const haiku = SAMPLE_MODELS.find((m) => m.model_id === 'anthropic/claude-haiku-3.5')!;
    const gpt4mini = SAMPLE_MODELS.find((m) => m.model_id === 'openai/gpt-4.1-mini')!;

    const haikuScore = computeValueScore(haiku);
    const gpt4miniScore = computeValueScore(gpt4mini);

    // Both are premium tier, but GPT-4.1 Mini is cheaper → higher value
    expect(gpt4miniScore).toBeGreaterThan(haikuScore);
  });

  it('returns positive scores for all sample models', () => {
    for (const model of SAMPLE_MODELS) {
      const score = computeValueScore(model);
      expect(score).toBeGreaterThan(0);
    }
  });

  it('returns a number, not NaN or Infinity', () => {
    for (const model of SAMPLE_MODELS) {
      const score = computeValueScore(model);
      expect(Number.isFinite(score)).toBe(true);
    }
  });

  it('ranks budget models with cheap pricing as high value', () => {
    const llama8b = SAMPLE_MODELS.find((m) => m.model_id === 'meta-llama/llama-3.1-8b-instruct')!;
    const sonnet = SAMPLE_MODELS.find((m) => m.model_id === 'anthropic/claude-sonnet-4')!;

    const llamaScore = computeValueScore(llama8b);
    const sonnetScore = computeValueScore(sonnet);

    // Llama 8B is much cheaper — should have higher value score
    // (despite lower quality tier, the cost advantage dominates)
    expect(llamaScore).toBeGreaterThan(sonnetScore);
  });
});
