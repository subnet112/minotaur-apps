/**
 * Fastify app: CORS (applied to every response, including errors — the missing
 * piece that made upstream 502s surface as confusing "CORS blocked" in the
 * browser), cached shared reads, the fast on-chain balances route, and a
 * transparent proxy for everything else under /v1.
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyCors from '@fastify/cors'
import { config } from './config.js'
import type { TtlCache } from './cache.js'
import { validatorFetch, validatorJson } from './validator.js'
import { getTokenList } from './tokens.js'
import { computeBalances, supportsChain, type BalancesResult } from './balances.js'

const PROXY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

// Only these request headers are forwarded upstream (host/connection/etc. must not be).
const FORWARD_HEADERS = ['content-type', 'authorization', 'accept'] as const

export async function buildServer(cache: TtlCache) {
  const app = Fastify({ logger: { level: config.logLevel } })

  // Capture raw bodies so the proxy can forward them verbatim. Our own routes
  // are all GET, so they don't need a parsed body.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  await app.register(fastifyCors, {
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
    methods: [...PROXY_METHODS, 'OPTIONS'],
    maxAge: 600,
  })

  app.get('/health', async () => ({ ok: true, ts: Date.now() }))

  // ── Transparent proxy (declared first so handlers below can delegate) ──────
  async function proxyToValidator(req: FastifyRequest, reply: FastifyReply) {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const headers: Record<string, string> = {}
    for (const h of FORWARD_HEADERS) {
      const v = req.headers[h]
      if (typeof v === 'string') headers[h] = v
    }
    const upstream = await validatorFetch(req.url, {
      method: req.method,
      headers,
      body: hasBody ? (req.body as Buffer) : undefined,
    })
    const text = await upstream.text()
    reply.code(upstream.status)
    const ct = upstream.headers.get('content-type')
    reply.header('content-type', ct ?? 'application/json')
    return reply.send(text)
  }

  // ── Cached shared reads (chains / apps / manifests) ────────────────────────
  async function cachedShared(req: FastifyRequest, reply: FastifyReply) {
    const key = `GET ${req.url}`
    const hadValue = cache.peek(key) !== undefined
    const data = await cache.get(key, { ttlMs: config.sharedTtlMs, staleMs: config.sharedStaleMs }, () =>
      validatorJson(req.url),
    )
    reply.header('x-swap-cache', hadValue ? 'hit' : 'miss')
    return data
  }
  app.get('/v1/chains', cachedShared)
  app.get('/v1/apps/', cachedShared)
  app.get('/v1/apps/manifests', cachedShared)
  app.get('/v1/apps/:id/status', cachedShared)
  app.get('/v1/apps/:id/manifest', cachedShared)

  // ── Fast on-chain balances (Multicall3) ────────────────────────────────────
  app.get('/v1/wallets/:address/balances', async (req: FastifyRequest, reply: FastifyReply) => {
    const { address } = req.params as { address: string }
    const chainId = Number((req.query as { chain_id?: string }).chain_id ?? 1)

    if (!supportsChain(chainId)) {
      if (config.balancesFallbackToValidator) return proxyToValidator(req, reply)
      reply.code(400)
      return { error: `unsupported chain_id ${chainId}` }
    }

    const key = `bal:${chainId}:${address.toLowerCase()}`
    const cached = cache.peek(key) !== undefined
    try {
      const data = await cache.get<BalancesResult>(
        key,
        { ttlMs: config.balancesTtlMs, staleMs: config.balancesStaleMs },
        async () => computeBalances(address, chainId, await getTokenList(chainId, cache)),
      )
      reply.header('x-swap-cache', cached ? 'hit-or-swr' : 'miss')
      return data
    } catch (err) {
      if (config.balancesFallbackToValidator) {
        app.log.warn({ err }, 'balances multicall failed; falling back to validator')
        return proxyToValidator(req, reply)
      }
      throw err
    }
  })

  // ── Everything else under /v1 → validator ──────────────────────────────────
  app.route({ method: [...PROXY_METHODS], url: '/v1/*', handler: proxyToValidator })

  // JSON errors, with CORS still applied by the plugin's onSend hook.
  app.setErrorHandler((err, req, reply) => {
    const raw = (err as { statusCode?: number }).statusCode
    const code = typeof raw === 'number' && raw >= 400 && raw < 600 ? raw : 502
    app.log.error({ err, url: req.url }, 'request failed')
    reply.code(code).send({ error: (err as Error).message ?? 'internal error' })
  })

  return app
}
