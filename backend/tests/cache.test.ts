import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from '../src/cache.js'

describe('TtlCache', () => {
  it('returns the cached value within ttl (fetcher called once)', async () => {
    const cache = new TtlCache()
    const fetcher = vi.fn(async () => 'v1')
    expect(await cache.get('k', { ttlMs: 1000 }, fetcher)).toBe('v1')
    expect(await cache.get('k', { ttlMs: 1000 }, fetcher)).toBe('v1')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent misses into a single in-flight fetch', async () => {
    const cache = new TtlCache()
    let resolve!: (v: string) => void
    const fetcher = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    const a = cache.get('k', { ttlMs: 1000 }, fetcher)
    const b = cache.get('k', { ttlMs: 1000 }, fetcher)
    resolve('shared')
    expect(await a).toBe('shared')
    expect(await b).toBe('shared')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('serves a stale value and refreshes in the background', async () => {
    vi.useFakeTimers()
    try {
      const cache = new TtlCache()
      let n = 0
      const fetcher = vi.fn(async () => `v${++n}`)
      expect(await cache.get('k', { ttlMs: 10, staleMs: 1000 }, fetcher)).toBe('v1')

      vi.setSystemTime(Date.now() + 50) // past ttl, within stale window
      // returns the stale value immediately...
      expect(await cache.get('k', { ttlMs: 10, staleMs: 1000 }, fetcher)).toBe('v1')
      // ...and the background refresh landed the new value
      await vi.waitFor(() => expect(cache.peek('k')).toBe('v2'))
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-fetches once fully expired (past ttl + stale)', async () => {
    vi.useFakeTimers()
    try {
      const cache = new TtlCache()
      let n = 0
      const fetcher = vi.fn(async () => `v${++n}`)
      expect(await cache.get('k', { ttlMs: 10, staleMs: 10 }, fetcher)).toBe('v1')
      vi.setSystemTime(Date.now() + 100)
      expect(await cache.get('k', { ttlMs: 10, staleMs: 10 }, fetcher)).toBe('v2')
    } finally {
      vi.useRealTimers()
    }
  })
})
