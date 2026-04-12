import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModelsByFilter, getDataFreshness } from '../db/models.js';
import type { Capability } from '@which-model/whichmodel-core';
import type { QueryCache } from '../cache.js';
import type { ToolTracker } from '../observability.js';

export function registerGetPricing(server: McpServer, supabase: SupabaseClient, cache?: QueryCache, tracker?: ToolTracker): void {
  server.registerTool(
    'get_pricing',
    {
      description:
        'Returns raw pricing and capability data for LLM models matching the supplied filters. ' +
        'Filters can be combined: specific model ID, provider name, maximum input price per million tokens, ' +
        'required capabilities (tool_calling, json_output, streaming, vision), and minimum context window. ' +
        'Results are ordered by value score; default limit is 20 (max 100). ' +
        'Each result includes input/output prices per MTok, context length, max output tokens, capabilities, quality tier, and value score. ' +
        'Use for programmatic price checks, budget validation, or building custom selection logic. ' +
        'Does not make recommendations — use recommend_model for that.',
      inputSchema: {
        model_id: z.string().optional().describe(
          'Specific model ID, e.g. "anthropic/claude-sonnet-4"',
        ),
        provider: z.string().optional().describe(
          'Filter to models from this provider, e.g. "anthropic"',
        ),
        max_input_price: z.number().positive().optional().describe(
          'Maximum input price per million tokens in USD',
        ),
        capabilities: z.array(
          z.enum(['tool_calling', 'json_output', 'streaming', 'vision'] as const),
        ).optional().describe(
          'Required capabilities to filter by',
        ),
        min_context_window: z.number().int().positive().optional().describe(
          'Minimum context window size in tokens',
        ),
        include_deprecated: z.boolean().default(false).describe(
          'Include deprecated and sunset models in results (default false)',
        ),
        limit: z.number().int().min(1).max(100).default(20).describe(
          'Maximum number of results to return (1-100, default 20)',
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      const startMs = Date.now();
      let cacheHit = false;
      let isError = false;
      try {
        // Check cache
        if (cache) {
          const cached = await cache.get('get_pricing', args);
          if (cached) {
            cacheHit = true;
            return { content: [{ type: 'text' as const, text: cached }] };
          }
        }

        const models = await getModelsByFilter(supabase, {
          model_id: args.model_id,
          provider: args.provider,
          max_input_price: args.max_input_price,
          capabilities: args.capabilities as Capability[] | undefined,
          min_context_window: args.min_context_window,
          include_deprecated: args.include_deprecated,
          limit: args.limit,
        });

        const dataFreshness = await getDataFreshness(supabase);

        const result = {
          models: models.map((m) => ({
            model_id: m.model_id,
            provider: m.provider,
            display_name: m.display_name,
            input_price_per_mtok: m.pricing_prompt * 1_000_000,
            output_price_per_mtok: m.pricing_completion * 1_000_000,
            image_price: m.pricing_image,
            context_length: m.context_length,
            max_output_tokens: m.max_output_tokens,
            capabilities: m.capabilities,
            quality_tier: m.quality_tier,
            value_score: m.value_score,
            availability_status: m.availability_status,
            deprecated_at: m.deprecated_at,
            last_updated: m.updated_at,
          })),
          total_results: models.length,
          data_freshness: dataFreshness,
        };

        const text = JSON.stringify(result, null, 2);

        // Store in cache
        if (cache) {
          await cache.set('get_pricing', args, text);
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        isError = true;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Failed to fetch pricing: ${err instanceof Error ? err.message : String(err)}`,
            }),
          }],
          isError: true,
        };
      } finally {
        tracker?.record('get_pricing', {
          latency_ms: Date.now() - startMs,
          error: isError,
          cache_hit: cacheHit,
        }).catch(() => {});
      }
    },
  );
}
