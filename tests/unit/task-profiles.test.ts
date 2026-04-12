import { describe, it, expect } from 'vitest';
import { TASK_PROFILES } from '@which-model/whichmodel-core';
import { TASK_TYPES } from '@which-model/whichmodel-core';

describe('TASK_PROFILES', () => {
  it('has a profile for every task type', () => {
    for (const taskType of TASK_TYPES) {
      expect(TASK_PROFILES[taskType]).toBeDefined();
      expect(TASK_PROFILES[taskType].task_type).toBe(taskType);
    }
  });

  it('all profiles have valid complexity weights that sum to ~1', () => {
    for (const profile of Object.values(TASK_PROFILES)) {
      for (const complexity of ['low', 'medium', 'high'] as const) {
        const weights = profile.complexity_weights[complexity];
        expect(weights.quality).toBeGreaterThanOrEqual(0);
        expect(weights.quality).toBeLessThanOrEqual(1);
        expect(weights.cost).toBeGreaterThanOrEqual(0);
        expect(weights.cost).toBeLessThanOrEqual(1);

        const sum = weights.quality + weights.cost;
        expect(sum).toBeCloseTo(1, 1); // within 0.1
      }
    }
  });

  it('all profiles have positive default token estimates', () => {
    for (const profile of Object.values(TASK_PROFILES)) {
      expect(profile.default_input_tokens).toBeGreaterThanOrEqual(0);
      // Embedding can have 0 output tokens
      expect(profile.default_output_tokens).toBeGreaterThanOrEqual(0);
      // But at least one should be positive
      expect(profile.default_input_tokens + profile.default_output_tokens).toBeGreaterThan(0);
    }
  });

  it('tool_calling task requires tool_calling capability', () => {
    expect(TASK_PROFILES.tool_calling.required_capabilities).toContain('tool_calling');
  });

  it('vision task requires vision capability', () => {
    expect(TASK_PROFILES.vision.required_capabilities).toContain('vision');
  });

  it('reasoning tasks prefer frontier tier', () => {
    expect(TASK_PROFILES.reasoning.ideal_quality_tier).toBe('frontier');
  });

  it('classification tasks are cost-optimised', () => {
    const lowWeights = TASK_PROFILES.classification.complexity_weights.low;
    expect(lowWeights.cost).toBeGreaterThan(lowWeights.quality);
  });

  it('high complexity always weights quality more than low complexity', () => {
    for (const profile of Object.values(TASK_PROFILES)) {
      const low = profile.complexity_weights.low;
      const high = profile.complexity_weights.high;
      expect(high.quality).toBeGreaterThanOrEqual(low.quality);
    }
  });
});
