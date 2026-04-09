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
import { runCapabilitySmokeTests } from './pipeline/capability-smoke-tests.js';
import { authMiddleware } from './middleware/auth.js';
import { handleSignup } from './routes/auth.js';
import { handleCreateCheckout, handleWebhook, handleBillingPortal } from './routes/billing.js';
import { handleGetUsage } from './routes/keys.js';
import { LANDING_HTML } from './landing.js';
import { QueryCache } from './cache.js';
import { ToolTracker } from './observability.js';
import { renderDashboardHTML, renderDashboardLoginHTML } from './dashboard.js';
import { handleTelegramWebhook } from './telegram/webhook.js';
import { notifyPriceChanges, notifyNewModels, notifyDeprecations } from './telegram/notifications.js';
import { getPriceChangesSince } from './db/price-history.js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_KEYS: KVNamespace;
  QUERY_CACHE: KVNamespace;
  TOOL_METRICS: KVNamespace;
  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_DEVELOPER_PRICE_ID: string;
  STRIPE_TEAM_PRICE_ID: string;
  // Resend (optional — signup email skipped if absent)
  RESEND_API_KEY?: string;
  APP_BASE_URL?: string;
  // OpenRouter API key for capability smoke tests
  OPENROUTER_API_KEY?: string;
  // Telegram bot
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  // Dashboard auth (shared secret — protects /dashboard and /observability/*)
  DASHBOARD_SECRET?: string;
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

/**
 * Validate dashboard access via DASHBOARD_SECRET.
 * Checks Authorization: Bearer <token>, ?token= query param, or cookie.
 * Returns null if allowed, or a 401 Response if denied.
 */
function checkDashboardAuth(request: Request, env: Env): Response | null {
  if (!env.DASHBOARD_SECRET) {
    // No secret configured — dashboard is open (backwards-compatible)
    return null;
  }

  const url = new URL(request.url);
  const secret = env.DASHBOARD_SECRET;

  // Check Bearer token
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7).trim() === secret) {
    return null;
  }

  // Check query param
  if (url.searchParams.get('token') === secret) {
    return null;
  }

  return new Response(
    JSON.stringify({ error: 'Unauthorized. Provide a valid dashboard token.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Extract a short hash prefix from the API key for unique caller tracking.
 * Returns null for unauthenticated requests.
 */
async function getCallerKeyPrefix(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  let rawKey: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7).trim();
  } else {
    const url = new URL(request.url);
    rawKey = url.searchParams.get('api_key');
  }
  if (!rawKey) return null;

  const data = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex.slice(0, 8);
}

export default {
  async scheduled(event: { cron?: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    const supabase = createServiceSupabaseClient(env);
    const isFullPipeline = event.cron === '0 */4 * * *';
    const isSmokeTest = event.cron === '0 */12 * * *';

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

      // Send Telegram notifications (best-effort, non-blocking)
      if (env.TELEGRAM_BOT_TOKEN && (result.priceChanges > 0 || result.newModels > 0 || result.deprecated > 0)) {
        ctx.waitUntil((async () => {
          try {
            // Get price changes from the last 4 hours (this pipeline interval)
            const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
            const changes = await getPriceChangesSince(supabase, since);
            const priceOnly = changes.filter((c) => c.change_type !== 'new_model');
            const newModelIds = changes.filter((c) => c.change_type === 'new_model').map((c) => c.model_id);

            if (priceOnly.length > 0) {
              await notifyPriceChanges(supabase, env.TELEGRAM_BOT_TOKEN!, priceOnly);
            }
            if (newModelIds.length > 0) {
              await notifyNewModels(supabase, env.TELEGRAM_BOT_TOKEN!, newModelIds);
            }
            // Deprecated models are tracked in pipeline alerts
            // TODO: Extract deprecated model IDs from pipeline result for deprecation notifications
          } catch (err) {
            console.error('Telegram notification error (pipeline):', err);
          }
        })());
      }
    } else if (isSmokeTest) {
      if (!env.OPENROUTER_API_KEY) {
        console.warn('Capability smoke tests skipped: OPENROUTER_API_KEY not set');
        return;
      }
      const result = await runCapabilitySmokeTests(supabase, env.OPENROUTER_API_KEY);
      if (result.errors.length > 0) {
        console.warn(`Smoke test errors: ${result.errors.join('; ')}`);
      }
      console.log(
        `Smoke tests done: ${result.tested} tested, ${result.passed} passed, ` +
        `${result.failed} failed, ${result.skipped} skipped`,
      );
    } else {
      const result = await runNewModelScan(supabase);
      if (result.alerts.length > 0) {
        console.warn(`New-model scan alerts: ${result.alerts.join('; ')}`);
      }
      console.log(
        `New-model scan done: scanned ${result.scanned} models, found ${result.newModels.length} new`,
      );

      // Notify about new models (best-effort)
      if (env.TELEGRAM_BOT_TOKEN && result.newModels.length > 0) {
        ctx.waitUntil(
          notifyNewModels(supabase, env.TELEGRAM_BOT_TOKEN, result.newModels)
            .catch((err) => console.error('Telegram notification error (new-model scan):', err)),
        );
      }
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

    // ── Dashboard (HTML) ──
    if (url.pathname === '/dashboard' && request.method === 'GET') {
      const dashAuthErr = checkDashboardAuth(request, env);
      if (dashAuthErr) {
        // Show login form instead of raw 401 for the HTML page
        return new Response(renderDashboardLoginHTML(), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(renderDashboardHTML(url.origin), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      });
    }

    // ── Observability dashboard JSON (legacy single-day) ──
    if (url.pathname === '/observability/dashboard' && request.method === 'GET') {
      const dashAuthErr = checkDashboardAuth(request, env);
      if (dashAuthErr) {
        const headers = new Headers(dashAuthErr.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        return new Response(dashAuthErr.body, { status: dashAuthErr.status, headers });
      }
      try {
        const supabase = createSupabaseClient(env);
        const tracker = new ToolTracker(env.TOOL_METRICS);
        const date = url.searchParams.get('date') ?? undefined;

        const [freshness, toolUsage, modelCounts] = await Promise.all([
          getDataFreshness(supabase),
          tracker.getDailyMetrics(date),
          supabase.from('models').select('availability_status', { count: 'exact', head: false }),
        ]);

        let activeModels = 0;
        let deprecatedModels = 0;
        if (modelCounts.data) {
          for (const row of modelCounts.data) {
            if (row.availability_status === 'active') activeModels++;
            else if (row.availability_status === 'deprecated') deprecatedModels++;
          }
        }

        return Response.json(
          {
            data_freshness: freshness,
            pipeline: {
              active_models: activeModels,
              deprecated_models: deprecatedModels,
            },
            tool_usage: toolUsage,
            period: date ?? new Date().toISOString().slice(0, 10),
          },
          { headers: CORS_HEADERS },
        );
      } catch (err) {
        console.error('Dashboard error:', err);
        return Response.json(
          { error: 'Failed to load dashboard' },
          { status: 500, headers: CORS_HEADERS },
        );
      }
    }

    // ── Observability dashboard-data JSON (multi-day, for HTML dashboard) ──
    if (url.pathname === '/observability/dashboard-data' && request.method === 'GET') {
      const dashAuthErr = checkDashboardAuth(request, env);
      if (dashAuthErr) {
        const headers = new Headers(dashAuthErr.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        return new Response(dashAuthErr.body, { status: dashAuthErr.status, headers });
      }
      try {
        const tracker = new ToolTracker(env.TOOL_METRICS);
        const days = Math.min(parseInt(url.searchParams.get('days') ?? '7', 10) || 7, 30);

        // Fetch KV metrics (always available)
        const dayDashboards = await tracker.getMultiDayDashboard(days);

        // DB info may fail gracefully (e.g., missing Supabase secrets)
        let freshness: string | null = null;
        let activeModels = 0;
        let deprecatedModels = 0;

        try {
          const supabase = createSupabaseClient(env);
          const [f, modelCounts] = await Promise.all([
            getDataFreshness(supabase),
            supabase.from('models').select('availability_status', { count: 'exact', head: false }),
          ]);
          freshness = f;
          if (modelCounts.data) {
            for (const row of modelCounts.data) {
              if (row.availability_status === 'active') activeModels++;
              else if (row.availability_status === 'deprecated') deprecatedModels++;
            }
          }
        } catch (dbErr) {
          console.warn('Dashboard: DB query failed, returning metrics only:', dbErr);
        }

        return Response.json(
          {
            data_freshness: freshness,
            active_models: activeModels,
            deprecated_models: deprecatedModels,
            days: dayDashboards,
          },
          { headers: CORS_HEADERS },
        );
      } catch (err) {
        console.error('Dashboard data error:', err);
        return Response.json(
          { error: 'Failed to load dashboard data' },
          { status: 500, headers: CORS_HEADERS },
        );
      }
    }

    // ── Telegram webhook ──
    if (url.pathname.startsWith('/telegram/webhook') && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
        return Response.json(
          { error: 'Telegram bot not configured' },
          { status: 503 },
        );
      }
      const supabase = createServiceSupabaseClient(env);
      return handleTelegramWebhook(request, supabase, {
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
      });
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
        const tracker = new ToolTracker(env.TOOL_METRICS);

        // Track unique callers (best-effort, non-blocking)
        const callerKeyPrefix = await getCallerKeyPrefix(request);
        tracker.recordCaller(callerKeyPrefix).catch(() => {});

        const transport = new WebStandardStreamableHTTPServerTransport();
        const server = createWhichModelServer(supabase, cache, tracker);
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
