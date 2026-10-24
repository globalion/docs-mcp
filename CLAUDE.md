# Deploying docs-mcp to Hetzner + regiq.in

Deploy pattern for future Claude Code sessions working on this repo.

## Server (shared with the rest of the Globalion MCP fleet)
- SSH: `root@89.167.56.16`
- Service directory: `/opt/docs-mcp/`
- Domain: `docs.regiq.in` (Cloudflare-tunnelled to `docs-mcp-web:3000`)
- Container names: `docs-mcp-web`, `docs-mcp-db`
- **NEVER touch** other people's folders under `/opt/` — see `shreyas-onboarding.md` §7.

## Deploy a new version

From this repo on your dev machine:

```bash
tar --exclude=node_modules --exclude=.next --exclude=.git -cf - . \
  | ssh root@89.167.56.16 "mkdir -p /opt/docs-mcp && tar -xf - -C /opt/docs-mcp/"
ssh root@89.167.56.16 "cd /opt/docs-mcp && docker compose up -d --build"
```

## First-time subdomain wiring (`docs.regiq.in`)

1. Add an ingress rule to `/opt/platform/cloudflared/config.yml` on the server, BEFORE the final catch-all rule:
   ```yaml
   - hostname: docs.regiq.in
     service: http://docs-mcp-web:3000
   ```
2. Restart the tunnel: `ssh root@89.167.56.16 "docker restart platform-cloudflared-1"`
3. Create the DNS CNAME via the tunnel's own creds (no API token needed):
   ```bash
   ssh root@89.167.56.16 "docker exec platform-cloudflared-1 cloudflared tunnel route dns 0caf1caf-59f6-4f36-9ea5-4aa9a9f41d0b docs.regiq.in"
   ```

## Env vars

Populated on the server via `/opt/docs-mcp/.env` (NOT committed to git). Per-app secrets are generated fresh; shared secrets come from `shreyas-onboarding.md`.

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — created per-MCP in Google Cloud Console
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL=https://docs.regiq.in`
- `PUBLIC_BASE_URL=https://docs.regiq.in`
- `OPENROUTER_API_KEY` — shared Globalion key
- `VISION_MODEL=google/gemini-2.5-flash-lite` (default; override for better quality)
- `EMBEDDING_MODEL=openai/text-embedding-3-small` (1536 dims — must match `Unsupported("vector(1536)")` in schema)
- `STRIPE_SECRET_KEY=sk_test_...` (from Pawan's Stripe account)
- `STRIPE_WEBHOOK_SECRET=whsec_...` (per-endpoint signing secret registered in Stripe dashboard)
- `ADMIN_EMAILS=shreyas.pavuluri@gmail.com`

## Health & debugging

```bash
curl https://docs.regiq.in/api/admin/health
ssh root@89.167.56.16 "docker ps --filter name=docs-mcp --format 'table {{.Names}}\t{{.Status}}'"
ssh root@89.167.56.16 "docker logs docs-mcp-web --tail 60"
```

Confirm pgvector is loaded:
```bash
ssh root@89.167.56.16 "docker exec docs-mcp-db psql -U admin -d docs_mcp -c 'SELECT extname FROM pg_extension;'"
```

## Rules (from shreyas-onboarding.md §7)

- ✅ **All LLM calls via OpenRouter.** Vision + embedding both. Never Google/OpenAI/Anthropic SDKs direct.
- ✅ Expose `/api/admin/health` (wired at `src/app/api/admin/health/route.ts`) — also verifies pgvector is loaded.
- ✅ Container names prefixed with `docs-mcp-` and unique across the fleet.
- ✅ Container-internal port is 3000; host port 3017 is a debugging fallback; Cloudflare tunnel handles external HTTPS.
- ✅ Stripe test mode until real customers exist; live keys require Shreyas green-light per-skill.
