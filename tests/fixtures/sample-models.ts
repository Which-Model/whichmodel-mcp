import type { Model } from '@which-model/whichmodel-core';

/**
 * Sample model data for offline tests.
 * Reflects realistic pricing and capabilities.
 */
export const SAMPLE_MODELS: Model[] = [
  {
    model_id: 'anthropic/claude-sonnet-4',
    provider: 'anthropic',
    display_name: 'Claude Sonnet 4',
    description: 'Fast, intelligent model for everyday tasks',
    context_length: 200000,
    max_output_tokens: 16000,
    modality: 'text+image->text',
    pricing_prompt: 0.000003,      // $3/M tokens
    pricing_completion: 0.000015,   // $15/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: true, json_output: true, streaming: true, vision: true },
    supported_parameters: ['temperature', 'tools', 'tool_choice', 'response_format'],
    quality_tier: 'frontier',
    value_score: 50,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    model_id: 'anthropic/claude-haiku-3.5',
    provider: 'anthropic',
    display_name: 'Claude 3.5 Haiku',
    description: 'Fast and affordable',
    context_length: 200000,
    max_output_tokens: 8192,
    modality: 'text+image->text',
    pricing_prompt: 0.0000008,     // $0.80/M tokens
    pricing_completion: 0.000004,   // $4/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: true, json_output: true, streaming: true, vision: true },
    supported_parameters: ['temperature', 'tools', 'tool_choice', 'response_format'],
    quality_tier: 'premium',
    value_score: 120,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    model_id: 'openai/gpt-4.1',
    provider: 'openai',
    display_name: 'GPT-4.1',
    description: 'Flagship OpenAI model',
    context_length: 1047576,
    max_output_tokens: 32768,
    modality: 'text+image->text',
    pricing_prompt: 0.000002,      // $2/M tokens
    pricing_completion: 0.000008,   // $8/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: true, json_output: true, streaming: true, vision: true },
    supported_parameters: ['temperature', 'tools', 'tool_choice', 'response_format'],
    quality_tier: 'frontier',
    value_score: 70,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    model_id: 'openai/gpt-4.1-mini',
    provider: 'openai',
    display_name: 'GPT-4.1 Mini',
    description: 'Affordable and fast',
    context_length: 1047576,
    max_output_tokens: 32768,
    modality: 'text+image->text',
    pricing_prompt: 0.0000004,     // $0.40/M tokens
    pricing_completion: 0.0000016,  // $1.60/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: true, json_output: true, streaming: true, vision: true },
    supported_parameters: ['temperature', 'tools', 'tool_choice', 'response_format'],
    quality_tier: 'premium',
    value_score: 200,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    model_id: 'google/gemini-2.5-flash',
    provider: 'google',
    display_name: 'Gemini 2.5 Flash',
    description: 'Fast and efficient',
    context_length: 1048576,
    max_output_tokens: 65536,
    modality: 'text+image->text',
    pricing_prompt: 0.00000015,    // $0.15/M tokens
    pricing_completion: 0.0000006,  // $0.60/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: true, json_output: true, streaming: true, vision: true },
    supported_parameters: ['temperature', 'tools', 'response_format'],
    quality_tier: 'premium',
    value_score: 300,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    model_id: 'deepseek/deepseek-chat',
    provider: 'deepseek',
    display_name: 'DeepSeek V3',
    description: 'Strong open-source model',
    context_length: 131072,
    max_output_tokens: 8192,
    modality: 'text->text',
    pricing_prompt: 0.0000003,     // $0.30/M tokens
    pricing_completion: 0.00000088, // $0.88/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: true, json_output: true, streaming: true, vision: false },
    supported_parameters: ['temperature', 'tools', 'response_format'],
    quality_tier: 'premium',
    value_score: 250,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    model_id: 'meta-llama/llama-3.1-8b-instruct',
    provider: 'meta-llama',
    display_name: 'Llama 3.1 8B Instruct',
    description: 'Small and efficient',
    context_length: 131072,
    max_output_tokens: 4096,
    modality: 'text->text',
    pricing_prompt: 0.00000005,    // $0.05/M tokens
    pricing_completion: 0.00000005, // $0.05/M tokens
    pricing_image: null,
    pricing_request: null,
    capabilities: { tool_calling: false, json_output: false, streaming: true, vision: false },
    supported_parameters: ['temperature'],
    quality_tier: 'budget',
    value_score: 350,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
];
