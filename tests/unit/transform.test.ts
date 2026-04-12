import { describe, it, expect } from 'vitest';
import { transformOpenRouterModel } from '../../src/pipeline/transform.js';
import type { OpenRouterModel } from '@which-model/whichmodel-core';

const sampleRaw: OpenRouterModel = {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  description: 'Fast intelligent model',
  context_length: 200000,
  architecture: {
    modality: 'text+image->text',
    tokenizer: 'Claude',
  },
  pricing: {
    prompt: '0.000003',
    completion: '0.000015',
    image: '0.0048',
    request: '0',
  },
  top_provider: {
    context_length: 200000,
    max_completion_tokens: 16000,
    is_moderated: true,
  },
  supported_parameters: ['temperature', 'top_p', 'tools', 'tool_choice', 'response_format'],
};

describe('transformOpenRouterModel()', () => {
  it('extracts provider from model ID', () => {
    const model = transformOpenRouterModel(sampleRaw);
    expect(model.provider).toBe('anthropic');
  });

  it('parses pricing strings to numbers', () => {
    const model = transformOpenRouterModel(sampleRaw);
    expect(model.pricing_prompt).toBe(0.000003);
    expect(model.pricing_completion).toBe(0.000015);
    expect(model.pricing_image).toBe(0.0048);
  });

  it('detects tool_calling from supported_parameters', () => {
    const model = transformOpenRouterModel(sampleRaw);
    expect(model.capabilities.tool_calling).toBe(true);
  });

  it('detects json_output from response_format parameter', () => {
    const model = transformOpenRouterModel(sampleRaw);
    expect(model.capabilities.json_output).toBe(true);
  });

  it('detects vision from modality', () => {
    const model = transformOpenRouterModel(sampleRaw);
    expect(model.capabilities.vision).toBe(true);
  });

  it('handles text-only model correctly', () => {
    const textOnly: OpenRouterModel = {
      ...sampleRaw,
      id: 'meta-llama/llama-3.1-8b-instruct',
      architecture: { modality: 'text->text' },
      supported_parameters: ['temperature'],
    };

    const model = transformOpenRouterModel(textOnly);
    expect(model.capabilities.vision).toBe(false);
    expect(model.capabilities.tool_calling).toBe(false);
    expect(model.capabilities.json_output).toBe(false);
  });

  it('assigns known quality tier for curated models', () => {
    const model = transformOpenRouterModel(sampleRaw);
    expect(model.quality_tier).toBe('frontier');
  });

  it('falls back to price-based tier for unknown models', () => {
    const unknown: OpenRouterModel = {
      ...sampleRaw,
      id: 'unknown-provider/mystery-model',
      pricing: { prompt: '0.000001', completion: '0.000002' },
    };

    const model = transformOpenRouterModel(unknown);
    // $1/M tokens → should be 'standard' tier via price heuristic
    expect(model.quality_tier).toBe('standard');
  });

  it('handles missing optional fields gracefully', () => {
    const minimal: OpenRouterModel = {
      id: 'test/minimal',
      name: 'Minimal Model',
      context_length: 4096,
      pricing: { prompt: '0.0001', completion: '0.0002' },
    };

    const model = transformOpenRouterModel(minimal);
    expect(model.model_id).toBe('test/minimal');
    expect(model.description).toBeNull();
    expect(model.max_output_tokens).toBeNull();
    expect(model.modality).toBe('text->text');
    expect(model.supported_parameters).toEqual([]);
  });
});
