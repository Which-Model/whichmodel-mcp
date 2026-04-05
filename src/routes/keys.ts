/**
 * GET /keys/usage
 *
 * Returns the current month's usage for the authenticated API key.
 *
 * Requires: Authorization: Bearer <api_key>
 *
 * Response:
 * {
 *   "plan": "free" | "developer" | "team",
 *   "monthly_limit": 1000,
 *   "used": 42,
 *   "remaining": 958,
 *   "month": "2026-04"
 * }
 */

import { createClient } from '@supabase/supabase-js';

export interface KeysEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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

export async function handleGetUsage(request: Request, env: KeysEnv): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ error: 'Authorization: Bearer <api_key> required.' }, { status: 401 });
  }
  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    return Response.json({ error: 'API key must not be empty.' }, { status: 401 });
  }

  const keyHash = await sha256Hex(rawKey);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: keyData, error: keyError } = await supabase
    .from('api_keys')
    .select('id, plan, monthly_limit, revoked_at, key_prefix')
    .eq('key_hash', keyHash)
    .single();

  if (keyError || !keyData) {
    return Response.json({ error: 'Invalid API key.' }, { status: 401 });
  }

  if (keyData.revoked_at) {
    return Response.json({ error: 'API key has been revoked.' }, { status: 402 });
  }

  const month = currentMonth();
  const { data: usageData } = await supabase
    .from('usage_monthly')
    .select('request_count')
    .eq('key_id', keyData.id)
    .eq('month', month)
    .single();

  const used = usageData?.request_count ?? 0;
  const remaining = Math.max(0, keyData.monthly_limit - used);

  return Response.json({
    key_prefix: keyData.key_prefix,
    plan: keyData.plan,
    monthly_limit: keyData.monthly_limit,
    used,
    remaining,
    month,
  });
}
