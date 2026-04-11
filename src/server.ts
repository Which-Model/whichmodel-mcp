import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRecommendModel } from './tools/recommend-model.js';
import { registerCompareModels } from './tools/compare-models.js';
import { registerGetPricing } from './tools/get-pricing.js';
import { registerCheckPriceChanges } from './tools/check-price-changes.js';
import { registerEstimateCost } from './tools/estimate-cost.js';
import { registerFindCheapestCapable } from './tools/find-cheapest-capable.js';
import { registerAgentPrompts } from './prompts/agent-integration.js';
import type { QueryCache } from './cache.js';
import type { ToolTracker } from './observability.js';

/**
 * Create a new McpServer instance with all tools registered.
 * Each session gets its own server instance (per SDK pattern).
 *
 * When a QueryCache is provided, tool responses are cached in Cloudflare KV
 * with TTLs appropriate to each tool category.
 */
export function createWhichModelServer(supabase: SupabaseClient, cache?: QueryCache, tracker?: ToolTracker): McpServer {
  const server = new McpServer({
    name: 'whichmodel',
    version: '1.1.1',
  });

  registerRecommendModel(server, supabase, cache, tracker);
  registerCompareModels(server, supabase, cache, tracker);
  registerGetPricing(server, supabase, cache, tracker);
  registerCheckPriceChanges(server, supabase, cache, tracker);
  registerEstimateCost(server, supabase, cache, tracker);
  registerFindCheapestCapable(server, supabase, cache, tracker);
  registerAgentPrompts(server);

  return server;
}

/**
 * Creates a WhichModel MCP server with a mock Supabase client for Smithery
 * capability scanning. No real credentials are required — tools are registered
 * with their full schemas but won't make live database calls.
 *
 * See: https://smithery.ai/docs/deploy#sandbox-server
 */
export function createSandboxServer(): McpServer {
  const mockSupabase = createClient(
    'https://placeholder.supabase.co',
    'placeholder-anon-key',
  );
  return createWhichModelServer(mockSupabase);
}
