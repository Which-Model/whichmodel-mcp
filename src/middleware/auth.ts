/**
 * API key authentication middleware for Cloudflare Workers.
 *
 * Flow for authenticated requests (Bearer token or ?api_key= present):
 *  1. Extract raw key from Authorization: Bearer <key> or ?api_key=<key>
 *  2. SHA-256 hash the key
 *  3. KV lookup (API_KEYS namespace, 5-min TTL) → fast path on hit
 *  4. On cache miss: query Supabase api_keys, populate KV
 *  5. If revoked → 402 Payment Required
 *  6. If over monthly limit → 429 Too Many Requests
 *  7. Async (non-blocking): atomically increment usage_monthly via RPC
 *  8. Return null → caller continues handling the request
 *
 * Unauthenticated requests (no key) are passed through — IP-based rate
 * limiting applies for the free tier.
 */

import { createClient } from '@supabase/supabase-js';

export interface AuthEnv {
  API_KEYS: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface KvKeyData {
  key_id: string;
  plan: string;
  monthly_limit: number;
  revoked: boolean;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Returns null if the request is allowed to proceed, or a Response to return
 * immediately (auth failure, revoked key, or usage limit exceeded).
 *
 * Add CORS headers to the returned Response at the call site if needed.
 */
export async function authMiddleware(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);

  // Extract API key
  let rawKey: string | null = null;
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7).trim();
  } else {
    rawKey = url.searchParams.get('api_key');
  }

  // No key present — pass through (free tier, IP-based rate limiting applies)
  if (!rawKey) {
    return null;
  }

  const keyHash = await sha256Hex(rawKey);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // KV cache lookup
  let kvData = await env.API_KEYS.get<KvKeyData>(keyHash, 'json');

  if (!kvData) {
    // Cache miss — query Supabase
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, plan, monthly_limit, revoked_at')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: 'Invalid API key.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    kvData = {
      key_id: data.id,
      plan: data.plan,
      monthly_limit: data.monthly_limit,
      revoked: !!data.revoked_at,
    };

    // Populate KV with 5-minute TTL
    await env.API_KEYS.put(keyHash, JSON.stringify(kvData), { expirationTtl: 300 });
  }

  // Revocation check
  if (kvData.revoked) {
    return new Response(
      JSON.stringify({ error: 'API key has been revoked. Please generate a new key or contact support.' }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Monthly usage check
  const month = currentMonth();
  const { data: usageData } = await supabase
    .from('usage_monthly')
    .select('request_count')
    .eq('key_id', kvData.key_id)
    .eq('month', month)
    .single();

  const currentCount = usageData?.request_count ?? 0;

  if (currentCount >= kvData.monthly_limit) {
    return new Response(
      JSON.stringify({
        error: 'Monthly request limit exceeded. Upgrade your plan to continue.',
        plan: kvData.plan,
        limit: kvData.monthly_limit,
        used: currentCount,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Async usage increment — atomic via Postgres function, non-blocking
  supabase
    .rpc('increment_usage', { p_key_id: kvData.key_id, p_month: month })
    .then(() => {})
    .catch(err => console.error('[auth] usage increment failed:', err));

  return null;
}
