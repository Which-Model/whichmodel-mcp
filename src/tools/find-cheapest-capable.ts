import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModelsByFilter, getDataFreshness } from '../db/models.js';
import type { Capability, QualityTier } from '@which-model/whichmodel-core';
import { QUALITY_TIER_SCORES } from '@which-model/whichmodel-core';
import type { QueryCache } from '../cache.js';
import type { ToolTracker } from '../observability.js';

/**
 * Map the user-facing quality_floor labels to the minimum QualityTier.
 * "low" = budget+, "medium" = standard+, "high" = premium+, "frontier" = frontier only.
 */
const QUALITY_FLOOR_MAP: Record<string, QualityTier> = {
  low: 'budget',
  medium: 'standard',
  high: 'premium',
  frontier: 'frontier',
};

export function registerFindCheapestCapable(server: McpServer, supabase: SupabaseClient, cache?: QueryCache, tracker?: ToolTracker): void {
  server.registerTool(
    'find_cheapest_capable',
    {
      description:
        'Find the cheapest models that meet specific capability requirements. ' +
        'Useful when you have hard constraints (e.g. must support tool_calling + vision) ' +
        'and want the most cost-effective option.',
      inputSchema: {
        required_capabilities: z.array(
          z.enum(['tool_calling', 'json_output', 'streaming', 'vision']),
        ).describe(
          'Capabilities the model must support, e.g. ["tool_calling", "json_output", "vision"]',
        ),
        min_context_window: z.number().int().positive().optional().describe(
          'Minimum context window size in tokens, e.g. 128000',
        ),
        quality_floor: z.enum(['low', 'medium', 'high', 'frontier']).optional().describe(
          'Minimum quality tier: "low" (budget+), "medium" (standard+), "high" (premium+), "frontier" (frontier only)',
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
          const cached = await cache.get('find_cheapest_capable', args);
          if (cached) {
            cacheHit = true;
            return { content: [{ type: 'text' as const, text: cached }] };
          }
        }

        const candidates = await getModelsByFilter(supabase, {
          capabilities: args.required_capabilities as Capability[],
          min_context_window: args.min_context_window,
          include_deprecated: false,
          limit: 200, // fetch broadly, filter in app
        });

        // Apply quality floor filter
        let filtered = candidates;
        if (args.quality_floor) {
          const minTier = QUALITY_FLOOR_MAP[args.quality_floor];
          const minScore = QUALITY_TIER_SCORES[minTier];
          filtered = candidates.filter(
            (m) => QUALITY_TIER_SCORES[m.quality_tier] >= minScore,
          );
        }

        // Already sorted by pricing_prompt ascending from getModelsByFilter
        const results = filtered.map((m) => ({
          model_id: m.model_id,
          provider: m.provider,
          display_name: m.display_name,
          input_price_per_mtok: m.pricing_prompt * 1_000_000,
          output_price_per_mtok: m.pricing_completion * 1_000_000,
          context_window: m.context_length,
          quality_tier: m.quality_tier,
          quality_confidence: m.quality_confidence,
          confirmed_capabilities: {
            tool_calling: m.capabilities.tool_calling,
            json_output: m.capabilities.json_output,
            streaming: m.capabilities.streaming,
            vision: m.capabilities.vision,
          },
        }));

        const dataFreshness = await getDataFreshness(supabase);

        const response = {
          total_matches: results.length,
          models: results,
          filters_applied: {
            required_capabilities: args.required_capabilities,
            min_context_window: args.min_context_window ?? null,
            quality_floor: args.quality_floor ?? null,
          },
          data_freshness: dataFreshness,
        };

        const text = JSON.stringify(response, null, 2);

        // Store in cache
        if (cache) {
          await cache.set('find_cheapest_capable', args, text);
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        isError = true;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Failed to find models: ${err instanceof Error ? err.message : String(err)}`,
            }),
          }],
          isError: true,
        };
      } finally {
        tracker?.record('find_cheapest_capable', {
          latency_ms: Date.now() - startMs,
          error: isError,
          cache_hit: cacheHit,
        }).catch(() => {});
      }
    },
  );
}
