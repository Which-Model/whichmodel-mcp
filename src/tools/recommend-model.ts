import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllActiveModels, getDataFreshness } from '../db/models.js';
import { recommend } from '@which-model/whichmodel-core';
import { TASK_TYPES, COMPLEXITY_LEVELS } from '@which-model/whichmodel-core';
import type { QueryCache } from '../cache.js';
import type { ToolTracker } from '../observability.js';

export function registerRecommendModel(server: McpServer, supabase: SupabaseClient, cache?: QueryCache, tracker?: ToolTracker): void {
  server.registerTool(
    'recommend_model',
    {
      description:
        'Get the single best-fit LLM for a task, with pricing and reasoning. ' +
        'Provide a task type and complexity; optionally add token estimates, a per-call budget cap, ' +
        'and capability requirements (tool calling, JSON output, streaming, context window, provider). ' +
        'Returns the recommended model, its cost estimate, a reasoning summary, and ranked alternatives. ' +
        'Use this when you need to select a model without knowing which to pick. ' +
        'Do not use for raw price lookups (use get_pricing) or for comparing specific known models (use compare_models). ' +
        'Data is refreshed automatically from OpenRouter; check data_freshness in the response for the last-updated timestamp.',
      inputSchema: {
        task_type: z.enum(TASK_TYPES).describe(
          'The type of task you need a model for',
        ),
        complexity: z.enum(COMPLEXITY_LEVELS).default('medium').describe(
          'Task complexity: low, medium, or high',
        ),
        estimated_input_tokens: z.number().int().positive().optional().describe(
          'Estimated input size in tokens',
        ),
        estimated_output_tokens: z.number().int().positive().optional().describe(
          'Estimated output size in tokens',
        ),
        budget_per_call: z.number().positive().optional().describe(
          'Maximum spend in USD for this single call',
        ),
        requirements: z.object({
          tool_calling: z.boolean().optional().describe('Must support tool/function calling'),
          json_output: z.boolean().optional().describe('Must support structured JSON output'),
          streaming: z.boolean().optional().describe('Must support streaming responses'),
          context_window_min: z.number().int().positive().optional().describe(
            'Minimum context window in tokens',
          ),
          providers_include: z.array(z.string()).optional().describe(
            'Preferred providers, e.g. ["anthropic", "openai"]',
          ),
          providers_exclude: z.array(z.string()).optional().describe(
            'Excluded providers, e.g. ["deepseek"]',
          ),
        }).optional().describe('Additional requirements for the model'),
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
          const cached = await cache.get('recommend_model', args);
          if (cached) {
            cacheHit = true;
            return { content: [{ type: 'text' as const, text: cached }] };
          }
        }

        const models = await getAllActiveModels(supabase);

        if (models.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'No models available in database. Run the seed script first: npm run seed',
              }),
            }],
          };
        }

        const dataFreshness = await getDataFreshness(supabase);

        const result = recommend(models, {
          task_type: args.task_type,
          complexity: args.complexity,
          estimated_input_tokens: args.estimated_input_tokens,
          estimated_output_tokens: args.estimated_output_tokens,
          budget_per_call: args.budget_per_call,
          requirements: args.requirements,
        }, dataFreshness);

        const text = JSON.stringify(result, null, 2);

        // Store in cache
        if (cache) {
          await cache.set('recommend_model', args, text);
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        isError = true;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Failed to generate recommendation: ${err instanceof Error ? err.message : String(err)}`,
            }),
          }],
          isError: true,
        };
      } finally {
        tracker?.record('recommend_model', {
          latency_ms: Date.now() - startMs,
          error: isError,
          cache_hit: cacheHit,
        }).catch(() => {});
      }
    },
  );
}
