# WHI-14 Deploy Checklist — Phase 1: API Key Infrastructure

## 1. Supabase: Run migration

Open the Supabase SQL editor for the whichmodel project and run:

```
migrations/001_api_keys.sql
```

This creates:
- `api_keys` table (key_hash, plan, monthly_limit, revoked_at, stripe fields)
- `usage_monthly` table (key_id, month, request_count)
- `increment_usage(p_key_id, p_month)` RPC function (atomic counter upsert)
- RLS enabled on both tables (service role bypasses RLS)

## 2. Cloudflare: Create KV namespace

```sh
wrangler kv namespace create API_KEYS
```

Copy the printed `id` and replace `__API_KEYS_NAMESPACE_ID__` in `wrangler.toml`.

For the preview/local environment, also run:
```sh
wrangler kv namespace create API_KEYS --preview
```
And add a `preview_id` line under `[[kv_namespaces]]` in wrangler.toml.

## 3. Cloudflare: Set new secret

```sh
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Paste the service role key from your Supabase project settings when prompted.

## 4. Deploy

```sh
npm run deploy
# or: wrangler deploy
```

## 5. Smoke test

Test an unauthenticated request (should still work, free tier):
```sh
curl https://routewise-mcp.<your-subdomain>.workers.dev/health
```

Test a revoked/invalid key (should return 401):
```sh
curl -H "Authorization: Bearer wm_live_invalidkey" https://routewise-mcp.<your-subdomain>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Insert a test key in Supabase and verify the full auth flow (KV cache, usage count).
