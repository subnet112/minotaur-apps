/**
 * In-memory TTL cache with stale-while-revalidate and single-flight dedup.
 *
 *   - within ttlMs                     → return cached value
 *   - ttlMs..(ttlMs+staleMs)           → return stale value, refresh in background
 *   - older / missing                  → await a fresh fetch
 *
 * Concurrent misses for the same key share one in-flight fetch (no stampede).
 * A failed background refresh keeps the last good value; a failed foreground
 * fetch rejects the caller.
 */

interface Entry<T> {
  value: T
  at: number
}

export interface CacheOpts {
  ttlMs: number
  /** Extra window past ttlMs during which a stale value is served while a
   *  background refresh runs. 0/undefined = no stale serving. */
  staleMs?: number
}

export class TtlCache {
  private store = new Map<string, Entry<unknown>>()
  private inflight = new Map<string, Promise<unknown>>()

  async get<T>(key: string, opts: CacheOpts, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key) as Entry<T> | undefined
    if (entry) {
      const age = Date.now() - entry.at
      if (age < opts.ttlMs) return entry.value
      if (opts.staleMs && age < opts.ttlMs + opts.staleMs) {
        // Serve stale, refresh in the background (swallow errors — keep last good).
        void this.revalidate(key, fetcher).catch(() => {})
        return entry.value
      }
    }
    return this.revalidate(key, fetcher)
  }

  /** Force a fetch, updating the cache. Shares an in-flight fetch if one exists. */
  refresh<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return this.revalidate(key, fetcher)
  }

  /** Last cached value for a key, if any (no fetch, no freshness check). */
  peek<T>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined
  }

  private revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    const p = (async () => {
      try {
        const value = await fetcher()
        this.store.set(key, { value, at: Date.now() })
        return value
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, p)
    return p
  }
}
