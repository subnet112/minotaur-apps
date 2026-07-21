/**
 * Bootstrap: build the server, warm the shared caches, and keep them warm on an
 * interval so the site is served from cache even with no traffic.
 */
import { config } from './config.js'
import { TtlCache } from './cache.js'
import { buildServer } from './server.js'
import { validatorJson } from './validator.js'

const WARM_PATHS = ['/v1/chains', '/v1/apps/', '/v1/apps/manifests']

const cache = new TtlCache()

async function warmShared(): Promise<void> {
  await Promise.allSettled(WARM_PATHS.map((p) => cache.refresh(`GET ${p}`, () => validatorJson(p))))
}

const app = await buildServer(cache)

// Warm now, then periodically. `.unref()` so the timer doesn't hold the process.
void warmShared()
setInterval(() => void warmShared(), config.sharedRefreshMs).unref()

try {
  const addr = await app.listen({ port: config.port, host: config.host })
  app.log.info(`swap-backend listening on ${addr} → validator ${config.validatorApiUrl}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
