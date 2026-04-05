/**
 * RouteWise MCP Server — Cloudflare Workers entry point.
 *
 * Stateless: creates a fresh McpServer + WebStandard transport per request.
 * This is the recommended pattern for serverless/edge deployments.
 *
 * The engine code (recommendation, scoring, task profiles) is identical
 * to the Express version — only the transport layer differs.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { registerRecommendModel } from './tools/recommend-model.js';
import { registerCompareModels } from './tools/compare-models.js';
import { registerGetPricing } from './tools/get-pricing.js';
import { registerCheckPriceChanges } from './tools/check-price-changes.js';
import { getDataFreshness } from './db/models.js';
import { authMiddleware } from './middleware/auth.js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_KEYS: KVNamespace;
}

function createSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

function createRouteWiseServer(supabase: SupabaseClient): McpServer {
  const server = new McpServer({
    name: 'routewise',
    version: '0.1.0',
  });

  registerRecommendModel(server, supabase);
  registerCompareModels(server, supabase);
  registerGetPricing(server, supabase);
  registerCheckPriceChanges(server, supabase);

  return server;
}

// CORS headers for MCP clients
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version, Authorization',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Health endpoint ──
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const supabase = createSupabaseClient(env);
        const freshness = await getDataFreshness(supabase);
        return Response.json(
          {
            status: 'ok',
            version: '0.1.0',
            runtime: 'cloudflare-workers',
            data_freshness: freshness,
          },
          { headers: CORS_HEADERS },
        );
      } catch {
        return Response.json(
          { status: 'degraded', error: 'Database connection issue' },
          { status: 503, headers: CORS_HEADERS },
        );
      }
    }

    // ── Well-known MCP discovery ──
    if (url.pathname === '/.well-known/mcp.json' && request.method === 'GET') {
      return Response.json(
        {
          mcp: {
            server: {
              name: 'routewise',
              version: '0.1.0',
              description:
                'Cost-optimised model routing advisor for autonomous agents. ' +
                'Query to get model recommendations based on task type, budget, and requirements.',
              url: '/mcp',
              capabilities: { tools: true },
            },
            tools: [
              { name: 'recommend_model', description: 'Get a cost-optimised model recommendation for a specific task type, complexity, and budget.' },
              { name: 'compare_models', description: 'Head-to-head comparison of 2-5 models with optional volume cost projections.' },
              { name: 'get_pricing', description: 'Raw pricing data lookup with filters by model, provider, price, and capabilities.' },
              { name: 'check_price_changes', description: 'See what model pricing has changed since a given date.' },
            ],
          },
        },
        { headers: CORS_HEADERS },
      );
    }

    // ── MCP endpoint ──
    if (url.pathname === '/mcp') {
      // Auth middleware: validates API key if present, enforces per-key limits.
      // Unauthenticated requests pass through (free tier, IP-based rate limiting).
      const authError = await authMiddleware(request, env);
      if (authError) {
        // Add CORS headers so browser clients see the error body
        const headers = new Headers(authError.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return new Response(authError.body, {
          status: authError.status,
          headers,
        });
      }

      try {
        const supabase = createSupabaseClient(env);
        const transport = new WebStandardStreamableHTTPServerTransport();
        const server = createRouteWiseServer(supabase);
        await server.connect(transport);

        const response = await transport.handleRequest(request);

        // Add CORS headers to the MCP response
        const newHeaders = new Headers(response.headers);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
          newHeaders.set(key, value);
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      } catch (error) {
        console.error('Error handling MCP request:', error);
        return Response.json(
          {
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          },
          { status: 500, headers: CORS_HEADERS },
        );
      }
    }

    // ── 404 for everything else ──
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
