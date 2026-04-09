/**
 * Observability module for WhichModel MCP server.
 *
 * Tracks tool usage, latency, and errors using Cloudflare KV for
 * persistent daily aggregates and structured console.log for real-time
 * log analysis via Workers Logpush / Tail.
 */

/** Shape of daily metrics stored in KV per tool. */
export interface ToolDayMetrics {
  calls: number;
  errors: number;
  cache_hits: number;
  total_latency_ms: number;
}

/** Shape of daily caller set stored in KV. */
export interface DayCallers {
  /** Short hash prefixes of unique API key callers. */
  callers: string[];
  /** Count of unauthenticated (anonymous) calls. */
  anonymous_calls: number;
}

/** Aggregated dashboard response for a single day. */
export interface DayDashboard {
  date: string;
  tool_usage: Record<string, ToolDayMetrics>;
  unique_callers: number;
  anonymous_calls: number;
  total_calls: number;
  total_errors: number;
  avg_latency_ms: number;
}

const TOOL_NAMES = [
  'recommend_model',
  'compare_models',
  'get_pricing',
  'check_price_changes',
  'estimate_cost',
  'find_cheapest_capable',
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function metricsKey(tool: string, date: string): string {
  return `metrics:${tool}:${date}`;
}

function callersKey(date: string): string {
  return `callers:${date}`;
}

/**
 * Tracks tool invocations in Cloudflare KV with daily granularity.
 *
 * Each tool+date combo gets a single KV key containing a JSON counter object.
 * KV keys auto-expire after 30 days to avoid unbounded growth.
 */
export class ToolTracker {
  constructor(private kv: KVNamespace) {}

  /**
   * Record a tool invocation. Call this after the tool handler completes.
   * Writes are best-effort — KV failures never break the request.
   */
  async record(tool: string, opts: {
    latency_ms: number;
    error: boolean;
    cache_hit: boolean;
  }): Promise<void> {
    const date = todayKey();
    const key = metricsKey(tool, date);

    try {
      // Structured log for real-time observability (Workers Logpush / wrangler tail)
      console.log(JSON.stringify({
        event: 'tool_invocation',
        tool,
        latency_ms: opts.latency_ms,
        error: opts.error,
        cache_hit: opts.cache_hit,
        date,
      }));

      // Read-modify-write daily counters in KV
      const existing = await this.kv.get(key, 'json') as ToolDayMetrics | null;
      const metrics: ToolDayMetrics = existing ?? {
        calls: 0,
        errors: 0,
        cache_hits: 0,
        total_latency_ms: 0,
      };

      metrics.calls += 1;
      if (opts.error) metrics.errors += 1;
      if (opts.cache_hit) metrics.cache_hits += 1;
      metrics.total_latency_ms += opts.latency_ms;

      // 30-day TTL keeps storage bounded
      await this.kv.put(key, JSON.stringify(metrics), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
    } catch {
      // Best-effort — never fail the request for metrics
    }
  }

  /**
   * Record a caller for unique-caller tracking.
   * Pass the first 8 chars of the API key hash, or null for anonymous.
   */
  async recordCaller(keyHashPrefix: string | null): Promise<void> {
    const date = todayKey();
    const key = callersKey(date);

    try {
      const existing = await this.kv.get(key, 'json') as DayCallers | null;
      const data: DayCallers = existing ?? { callers: [], anonymous_calls: 0 };

      if (keyHashPrefix) {
        if (!data.callers.includes(keyHashPrefix)) {
          data.callers.push(keyHashPrefix);
        }
      } else {
        data.anonymous_calls += 1;
      }

      await this.kv.put(key, JSON.stringify(data), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
    } catch {
      // Best-effort
    }
  }

  /**
   * Retrieve daily metrics for all tools on a given date.
   */
  async getDailyMetrics(date?: string): Promise<Record<string, ToolDayMetrics>> {
    const d = date ?? todayKey();
    const result: Record<string, ToolDayMetrics> = {};

    // Fetch all tools in parallel
    const entries = await Promise.all(
      TOOL_NAMES.map(async (tool) => {
        try {
          const data = await this.kv.get(metricsKey(tool, d), 'json') as ToolDayMetrics | null;
          return [tool, data] as const;
        } catch {
          return [tool, null] as const;
        }
      }),
    );

    for (const [tool, data] of entries) {
      result[tool] = data ?? { calls: 0, errors: 0, cache_hits: 0, total_latency_ms: 0 };
    }

    return result;
  }

  /**
   * Get caller data for a given date.
   */
  async getDayCallers(date?: string): Promise<DayCallers> {
    const d = date ?? todayKey();
    try {
      const data = await this.kv.get(callersKey(d), 'json') as DayCallers | null;
      return data ?? { callers: [], anonymous_calls: 0 };
    } catch {
      return { callers: [], anonymous_calls: 0 };
    }
  }

  /**
   * Build dashboard data for the last N days.
   */
  async getMultiDayDashboard(days: number = 7): Promise<DayDashboard[]> {
    const results: DayDashboard[] = [];
    const dates: string[] = [];

    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const dayData = await Promise.all(
      dates.map(async (date) => {
        const [toolUsage, callerData] = await Promise.all([
          this.getDailyMetrics(date),
          this.getDayCallers(date),
        ]);
        return { date, toolUsage, callerData };
      }),
    );

    for (const { date, toolUsage, callerData } of dayData) {
      let totalCalls = 0;
      let totalErrors = 0;
      let totalLatency = 0;

      for (const metrics of Object.values(toolUsage)) {
        totalCalls += metrics.calls;
        totalErrors += metrics.errors;
        totalLatency += metrics.total_latency_ms;
      }

      results.push({
        date,
        tool_usage: toolUsage,
        unique_callers: callerData.callers.length,
        anonymous_calls: callerData.anonymous_calls,
        total_calls: totalCalls,
        total_errors: totalErrors,
        avg_latency_ms: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
      });
    }

    return results;
  }
}
