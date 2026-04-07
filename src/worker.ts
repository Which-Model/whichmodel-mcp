/**
 * WhichModel MCP Server — Cloudflare Workers entry point.
 *
 * Stateless: creates a fresh McpServer + WebStandard transport per request.
 * This is the recommended pattern for serverless/edge deployments.
 *
 * The engine code (recommendation, scoring, task profiles) is identical
 * to the Express version — only the transport layer differs.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createWhichModelServer } from './server.js';
import { getDataFreshness } from './db/models.js';
import { runPricingPipeline } from './pipeline/run-pipeline.js';
import { runNewModelScan } from './pipeline/new-model-scan.js';
import { authMiddleware } from './middleware/auth.js';
import { handleSignup } from './routes/auth.js';
import { handleCreateCheckout, handleWebhook, handleBillingPortal } from './routes/billing.js';
import { handleGetUsage } from './routes/keys.js';
import { LANDING_HTML } from './landing.js';
import { QueryCache } from './cache.js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_KEYS: KVNamespace;
  QUERY_CACHE: KVNamespace;
  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_DEVELOPER_PRICE_ID: string;
  STRIPE_TEAM_PRICE_ID: string;
  // Resend (optional — signup email skipped if absent)
  RESEND_API_KEY?: string;
  APP_BASE_URL?: string;
}

function createSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

// CORS headers for MCP clients
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version, Authorization',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
};

function createServiceSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export default {
  async scheduled(event: { cron?: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    const supabase = createServiceSupabaseClient(env);
    const isFullPipeline = event.cron === '0 */4 * * *';

    if (isFullPipeline) {
      const result = await runPricingPipeline(supabase);
      if (result.alerts.length > 0) {
        console.warn(
          `Scheduled pipeline completed with ${result.alerts.length} alert(s): ` +
          result.alerts.join('; '),
        );
      }
      console.log(
        `Scheduled pipeline done: ${result.updated} updated, ` +
        `${result.priceChanges} price changes, ${result.newModels} new models`,
      );
    } else {
      const result = await runNewModelScan(supabase);
      if (result.alerts.length > 0) {
        console.warn(`New-model scan alerts: ${result.alerts.join('; ')}`);
      }
      console.log(
        `New-model scan done: scanned ${result.scanned} models, found ${result.newModels.length} new`,
      );
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Landing page ──
    if ((url.pathname === '/' || url.pathname === '') && request.method === 'GET') {
      return new Response(LANDING_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
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
              name: 'whichmodel',
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

    // ── Signup ──
    if (url.pathname === '/auth/signup' && request.method === 'POST') {
      const response = await handleSignup(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }

    // ── Billing: create Checkout session ──
    if (url.pathname === '/billing/create-checkout' && request.method === 'POST') {
      const response = await handleCreateCheckout(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }

    // ── Billing: Stripe webhook ──
    if (url.pathname === '/billing/webhook' && request.method === 'POST') {
      // No CORS needed — Stripe calls this server-side
      return handleWebhook(request, env);
    }

    // ── Billing: Customer Portal redirect ──
    if (url.pathname === '/billing/portal' && request.method === 'GET') {
      return handleBillingPortal(request, env);
    }

    // ── Keys: usage ──
    if (url.pathname === '/keys/usage' && request.method === 'GET') {
      const response = await handleGetUsage(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
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
        const cache = new QueryCache(env.QUERY_CACHE);
        const transport = new WebStandardStreamableHTTPServerTransport();
        const server = createWhichModelServer(supabase, cache);
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
