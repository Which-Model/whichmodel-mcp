/**
 * POST /auth/signup
 *
 * Creates a free API key for the given email address and optionally sends a
 * welcome email via Resend.  The raw key is returned exactly once — we only
 * store the sha256 hash.
 *
 * Request body (JSON):  { "email": "user@example.com" }
 * Response (JSON):      { "api_key": "wm_live_…", "email": "…", "plan": "free", "monthly_limit": 1000 }
 *
 * Error responses:
 *   400  – missing or invalid email
 *   409  – email already has an active key
 */

import { createClient } from '@supabase/supabase-js';

export interface SignupEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;       // optional — email skipped when absent
  APP_BASE_URL?: string;         // e.g. https://whichmodel.dev (for email links)
}

const FREE_MONTHLY_LIMIT = 1_000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** wm_live_ + 32 random hex chars */
function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `wm_live_${hex}`;
}

async function sendWelcomeEmail(
  resendKey: string,
  email: string,
  apiKey: string,
  baseUrl: string,
): Promise<void> {
  const body = JSON.stringify({
    from: 'WhichModel <noreply@whichmodel.dev>',
    to: [email],
    subject: 'Your WhichModel API key',
    html: `
      <p>Hi,</p>
      <p>Here is your free-tier API key for WhichModel:</p>
      <pre style="font-family:monospace;background:#f5f5f5;padding:12px;border-radius:4px">${apiKey}</pre>
      <p><strong>Keep it safe</strong> — this is the only time it will be shown.</p>
      <ul>
        <li>Free tier: 1,000 requests/month</li>
        <li>Pass the key as <code>Authorization: Bearer &lt;key&gt;</code> on every MCP request.</li>
        <li>Check your usage: <a href="${baseUrl}/keys/usage">${baseUrl}/keys/usage</a></li>
        <li>Upgrade anytime: <a href="${baseUrl}/billing/create-checkout">${baseUrl}</a></li>
      </ul>
      <p>Happy routing,<br>The WhichModel team</p>
    `,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    // Log but don't fail the signup request — email is best-effort.
    console.error('[signup] Resend error:', res.status, await res.text());
  }
}

export async function handleSignup(request: Request, env: SignupEnv): Promise<Response> {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Idempotency check: if this email already has an active (non-revoked) key, return 409.
  const { data: existing } = await supabase
    .from('api_keys')
    .select('id')
    .eq('email', email)
    .is('revoked_at', null)
    .limit(1)
    .single();

  if (existing) {
    return Response.json(
      { error: 'An active API key already exists for this email. Check your inbox or contact support.' },
      { status: 409 },
    );
  }

  const rawKey = generateApiKey();
  const keyHash = await sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, 12); // "wm_live_" + 4 chars

  const { error: insertError } = await supabase.from('api_keys').insert({
    key_hash: keyHash,
    key_prefix: keyPrefix,
    email,
    plan: 'free',
    monthly_limit: FREE_MONTHLY_LIMIT,
  });

  if (insertError) {
    console.error('[signup] insert error:', insertError);
    return Response.json({ error: 'Failed to create API key. Please try again.' }, { status: 500 });
  }

  // Best-effort welcome email
  if (env.RESEND_API_KEY) {
    const baseUrl = env.APP_BASE_URL ?? 'https://whichmodel.dev';
    // Fire-and-forget — don't await, don't fail on error
    sendWelcomeEmail(env.RESEND_API_KEY, email, rawKey, baseUrl).catch(() => {});
  }

  return Response.json(
    {
      api_key: rawKey,
      email,
      plan: 'free',
      monthly_limit: FREE_MONTHLY_LIMIT,
      note: 'Save this key — it will not be shown again.',
    },
    { status: 201 },
  );
}
