import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModelsByIds, getDataFreshness } from '../db/models.js';
import { getBenchmarksForModels, buildBenchmarkSummary } from '../db/benchmarks.js';
import type { ModelComparison } from '@which-model/whichmodel-core';
import type { QueryCache } from '../cache.js';
import type { ToolTracker } from '../observability.js';

export function registerCompareModels(server: McpServer, supabase: SupabaseClient, cache?: QueryCache, tracker?: ToolTracker): void {
  server.registerTool(
    'compare_models',
    {
      description:
        'Side-by-side comparison of 2–5 specific LLMs by pricing, quality tier, capabilities, and projected costs. ' +
        'Supply model IDs (e.g. "anthropic/claude-sonnet-4", "openai/gpt-4.1"); add an optional volume object ' +
        'to see daily and monthly cost estimates based on expected call volume and token sizes. ' +
        'Returns models sorted by value score, with a plain-English recommendation highlighting best value, ' +
        'cheapest, and highest-quality options. Unknown model IDs are reported in not_found without raising an error. ' +
        'Use when you already have specific candidates and want a structured diff. ' +
        'Do not use for open-ended model discovery — use recommend_model instead.',
      inputSchema: {
        models: z.array(z.string()).min(2).max(5).describe(
          'Model IDs to compare, e.g. ["anthropic/claude-sonnet-4", "openai/gpt-4.1"]',
        ),
        task_type: z.enum([
          'chat', 'code_generation', 'code_review', 'summarisation',
          'translation', 'data_extraction', 'tool_calling', 'creative_writing',
          'research', 'classification', 'embedding', 'vision', 'reasoning',
        ] as const).optional().describe('Task type for context-aware comparison'),
        volume: z.object({
          calls_per_day: z.number().int().positive().describe('Expected calls per day'),
          avg_input_tokens: z.number().int().positive().describe('Average input tokens per call'),
          avg_output_tokens: z.number().int().positive().describe('Average output tokens per call'),
        }).optional().describe('Expected usage volume for cost projections'),
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
          const cached = await cache.get('compare_models', args);
          if (cached) {
            cacheHit = true;
            return { content: [{ type: 'text' as const, text: cached }] };
          }
        }

        const models = await getModelsByIds(supabase, args.models);
        const dataFreshness = await getDataFreshness(supabase);

        // Fetch benchmark data for all requested models
        const benchmarkMap = await getBenchmarksForModels(supabase, args.models);

        // Check for models not found
        const foundIds = new Set(models.map((m) => m.model_id));
        const notFound = args.models.filter((id) => !foundIds.has(id));

        const comparisons: ModelComparison[] = models.map((m) => {
          let dailyCost: number | null = null;
          let monthlyCost: number | null = null;

          if (args.volume) {
            const costPerCall =
              (m.pricing_prompt * args.volume.avg_input_tokens) +
              (m.pricing_completion * args.volume.avg_output_tokens);
            dailyCost = Math.round(costPerCall * args.volume.calls_per_day * 1_000_000) / 1_000_000;
            monthlyCost = Math.round(dailyCost * 30 * 1_000_000) / 1_000_000;
          }

          const entries = benchmarkMap.get(m.model_id);
          const benchmarks = entries?.length ? buildBenchmarkSummary(entries) : undefined;

          return {
            model_id: m.model_id,
            provider: m.provider,
            display_name: m.display_name,
            input_price_per_mtok: m.pricing_prompt * 1_000_000,
            output_price_per_mtok: m.pricing_completion * 1_000_000,
            daily_cost_estimate: dailyCost,
            monthly_cost_estimate: monthlyCost,
            context_length: m.context_length,
            capabilities: m.capabilities,
            quality_tier: m.quality_tier,
            quality_confidence: m.quality_confidence,
            value_score: m.value_score,
            benchmarks,
          };
        });

        // Sort by value_score descending
        comparisons.sort((a, b) => (b.value_score ?? 0) - (a.value_score ?? 0));

        // Generate summary
        const cheapest = [...comparisons].sort(
          (a, b) => a.input_price_per_mtok - b.input_price_per_mtok,
        )[0];
        const highestQuality = [...comparisons].sort(
          (a, b) => {
            const tiers = ['frontier', 'premium', 'standard', 'budget', 'economy'];
            return tiers.indexOf(a.quality_tier) - tiers.indexOf(b.quality_tier);
          },
        )[0];
        const bestValue = comparisons[0];

        let recommendation = `Best value: ${bestValue?.display_name ?? 'N/A'}.`;
        if (cheapest && cheapest.model_id !== bestValue?.model_id) {
          recommendation += ` Cheapest: ${cheapest.display_name}.`;
        }
        if (highestQuality && highestQuality.model_id !== bestValue?.model_id) {
          recommendation += ` Highest quality: ${highestQuality.display_name}.`;
        }

        const result = {
          comparisons,
          recommendation,
          not_found: notFound.length > 0 ? notFound : undefined,
          data_freshness: dataFreshness,
        };

        const text = JSON.stringify(result, null, 2);

        // Store in cache
        if (cache) {
          await cache.set('compare_models', args, text);
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        isError = true;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Failed to compare models: ${err instanceof Error ? err.message : String(err)}`,
            }),
          }],
          isError: true,
        };
      } finally {
        tracker?.record('compare_models', {
          latency_ms: Date.now() - startMs,
          error: isError,
          cache_hit: cacheHit,
        }).catch(() => {});
      }
    },
  );
}
