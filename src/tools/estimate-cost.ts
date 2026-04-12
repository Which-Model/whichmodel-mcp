import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModelById, getModelsByFilter, getDataFreshness } from '../db/models.js';
import type { Model, Capability } from '@which-model/whichmodel-core';
import type { QueryCache } from '../cache.js';
import type { ToolTracker } from '../observability.js';

/**
 * Find the cheapest active model that has at least the same capabilities
 * as the reference model.
 */
async function findCheapestAlternative(
  supabase: SupabaseClient,
  referenceModel: Model,
): Promise<Model | null> {
  // Collect required capabilities from the reference model
  const requiredCaps: Capability[] = [];
  if (referenceModel.capabilities.tool_calling) requiredCaps.push('tool_calling');
  if (referenceModel.capabilities.json_output) requiredCaps.push('json_output');
  if (referenceModel.capabilities.vision) requiredCaps.push('vision');

  const candidates = await getModelsByFilter(supabase, {
    capabilities: requiredCaps.length > 0 ? requiredCaps : undefined,
    min_context_window: referenceModel.context_length,
    include_deprecated: false,
    limit: 100,
  });

  // Filter out the reference model itself, then pick cheapest by combined price
  const alternatives = candidates.filter((m) => m.model_id !== referenceModel.model_id);
  if (alternatives.length === 0) return null;

  // Already sorted by pricing_prompt ascending from getModelsByFilter
  return alternatives[0] ?? null;
}

export function registerEstimateCost(server: McpServer, supabase: SupabaseClient, cache?: QueryCache, tracker?: ToolTracker): void {
  server.registerTool(
    'estimate_cost',
    {
      description:
        'Estimate the cost of a specific workload for a given model. ' +
        'Returns cost per call, daily and monthly projections, and a comparison ' +
        'to the cheapest alternative with equivalent capabilities.',
      inputSchema: {
        model_id: z.string().describe(
          'Model ID to estimate cost for, e.g. "anthropic/claude-sonnet-4"',
        ),
        input_tokens: z.number().int().positive().describe(
          'Number of input tokens per call',
        ),
        output_tokens: z.number().int().positive().describe(
          'Number of output tokens per call',
        ),
        calls_per_day: z.number().int().positive().optional().describe(
          'Expected number of calls per day (for daily/monthly projections)',
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
          const cached = await cache.get('estimate_cost', args);
          if (cached) {
            cacheHit = true;
            return { content: [{ type: 'text' as const, text: cached }] };
          }
        }

        const model = await getModelById(supabase, args.model_id);

        if (!model) {
          isError = true;
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: `Model "${args.model_id}" not found.`,
              }),
            }],
            isError: true,
          };
        }

        // Cost per call in USD
        const costPerCall =
          (model.pricing_prompt * args.input_tokens) +
          (model.pricing_completion * args.output_tokens);

        // Round to 8 decimal places to avoid floating-point noise
        const round = (n: number) => Math.round(n * 1e8) / 1e8;

        const costEstimate: Record<string, unknown> = {
          model_id: model.model_id,
          display_name: model.display_name,
          provider: model.provider,
          quality_tier: model.quality_tier,
          input_price_per_mtok: model.pricing_prompt * 1_000_000,
          output_price_per_mtok: model.pricing_completion * 1_000_000,
          cost_per_call_usd: round(costPerCall),
        };

        if (args.calls_per_day != null) {
          const dailyCost = costPerCall * args.calls_per_day;
          const monthlyCost = dailyCost * 30;
          costEstimate.daily_cost_usd = round(dailyCost);
          costEstimate.monthly_cost_usd = round(monthlyCost);
          costEstimate.calls_per_day = args.calls_per_day;
        }

        // Find cheapest alternative with same capabilities
        const cheapest = await findCheapestAlternative(supabase, model);
        let cheapestComparison: Record<string, unknown> | null = null;

        if (cheapest) {
          const cheapestCostPerCall =
            (cheapest.pricing_prompt * args.input_tokens) +
            (cheapest.pricing_completion * args.output_tokens);

          const savings = costPerCall - cheapestCostPerCall;
          const savingsPct = costPerCall > 0
            ? Math.round((savings / costPerCall) * 10000) / 100
            : 0;

          cheapestComparison = {
            model_id: cheapest.model_id,
            display_name: cheapest.display_name,
            provider: cheapest.provider,
            quality_tier: cheapest.quality_tier,
            cost_per_call_usd: round(cheapestCostPerCall),
            savings_per_call_usd: round(savings),
            savings_percent: savingsPct,
          };

          if (args.calls_per_day != null) {
            const cheapestDaily = cheapestCostPerCall * args.calls_per_day;
            cheapestComparison.daily_cost_usd = round(cheapestDaily);
            cheapestComparison.monthly_cost_usd = round(cheapestDaily * 30);
            cheapestComparison.monthly_savings_usd = round((costPerCall - cheapestCostPerCall) * args.calls_per_day * 30);
          }
        }

        const dataFreshness = await getDataFreshness(supabase);

        const result = {
          estimate: costEstimate,
          cheapest_alternative: cheapestComparison,
          data_freshness: dataFreshness,
        };

        const text = JSON.stringify(result, null, 2);

        // Store in cache
        if (cache) {
          await cache.set('estimate_cost', args, text);
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        isError = true;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Failed to estimate cost: ${err instanceof Error ? err.message : String(err)}`,
            }),
          }],
          isError: true,
        };
      } finally {
        tracker?.record('estimate_cost', {
          latency_ms: Date.now() - startMs,
          error: isError,
          cache_hit: cacheHit,
        }).catch(() => {});
      }
    },
  );
}
