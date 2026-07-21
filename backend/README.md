# Minotaur Swap Backend (BFF)

A small backend-for-frontend for the swap UI. It makes the website **independent
of the validator API**: it caches shared data, computes wallet balances
**on-chain** instead of hammering the validator, and transparently proxies
everything else — with CORS applied to *every* response (including errors).

## Why

The swap site called `api.minotaursubnet.com` directly. The per-wallet
`/balances` endpoint takes ~10–17 s server-side, occasionally tips over the
gateway timeout, and nginx's `502` page carries no CORS header — so the browser
reported a misleading *"CORS blocked"* error. This service fixes both the speed
and the error surface, and offloads that work from the validator.

## What it does

| Route | Behaviour |
|---|---|
| `GET /v1/wallets/:addr/balances?chain_id=` | **Computed on-chain** via Multicall3 (viem) over the same token set the selector shows (Superchain + bundled snapshots incl. wTAO). One RPC round, short per-address cache. |
| `GET /v1/chains`, `/v1/apps/`, `/v1/apps/manifests`, `/v1/apps/:id/{status,manifest}` | **Cached** from the validator (TTL + stale-while-revalidate), warmed on an interval so they're served from cache even with no traffic. |
| everything else under `/v1/*` | **Transparently proxied** to the validator (quotes, orders, prepare, submit, signatures, faucet, …). |
| `GET /health` | Liveness. |

All responses — including 4xx/5xx and the proxied passthrough — carry the
configured CORS headers, so upstream failures show up as honest API errors in
the UI, never as a CORS block.

## Configuration

Every value has a safe default (public validator + public RPCs). See
[`.env.example`](./.env.example). The ones that matter in production:

- `ALLOWED_ORIGINS` — the swap origin(s), comma-separated (`*` to allow any).
- `VALIDATOR_API_URL` — upstream (default `https://api.minotaursubnet.com`).
- `ETH_RPC_URL` / `BASE_RPC_URL` — **use dedicated RPCs** (Alchemy/Infura) for
  reliable balances; public endpoints are rate-limited.
- `BALANCES_FALLBACK_TO_VALIDATOR` — if `true`, fall back to proxying the
  validator's `/balances` when the on-chain path errors.

## Local development

```bash
pnpm install
pnpm sync:tokens     # refresh the bundled token snapshots from the frontend
pnpm dev             # tsx watch, on :8080
pnpm test            # unit tests
pnpm typecheck
pnpm build           # -> dist/index.js
```

Token snapshots (`src/tokens/generated/*`) are copied from
`frontend/swap/src/config/*` by `pnpm sync:tokens` and committed, so the Docker
build is self-contained. Re-run after a snapshot refresh.

## Deploy (Docker, on the EC2 box)

```bash
# on the instance, in this directory:
cp .env.example .env        # then edit: ALLOWED_ORIGINS, ETH_RPC_URL, BASE_RPC_URL
docker compose up -d --build
docker compose logs -f
curl -s localhost:8080/health
```

### Suggested EC2 setup

- A small instance (t3.small is plenty — it's I/O bound, not CPU).
- Security group: inbound `443` (and `80` for ACME) from the internet; the app
  listens on `8080` behind TLS.
- Put TLS + a public hostname in front (e.g. `swap-api.minotaursubnet.com`):
  Caddy or nginx terminating HTTPS and reverse-proxying to `127.0.0.1:8080`.
  (Caddy gets you auto-HTTPS in ~3 lines; ask and this PR can add a Caddy
  service to the compose file.)
- Point the hostname's DNS at the instance (Elastic IP recommended).

### Wire the frontend to it (after the box is up)

The swap frontend picks its API base from `VITE_API_URL` at build time. Once
this backend is reachable at, say, `https://swap-api.minotaursubnet.com`, set in
the deploy that builds the swap iframe (mainapp `deploy.yml`):

```yaml
VITE_API_URL: https://swap-api.minotaursubnet.com
```

and redeploy. The frontend then talks only to this BFF — same-origin-friendly,
cached, and fast. **Don't flip this until the box is live**, or the site would
point at a backend that doesn't exist yet.

## Notes

- Stateless and horizontally scalable; the cache is per-instance (in-memory).
  For multiple instances behind a load balancer, that's fine — each warms its
  own cache; add Redis later only if you need a shared one.
- Writes (POST/PATCH/DELETE) are never cached — always proxied straight through.
