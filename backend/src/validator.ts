/**
 * Thin client for the upstream validator API, with a hard timeout so a slow
 * upstream can't hang the BFF (the exact failure mode behind the 502s the
 * website was seeing).
 */
import { config } from './config.js'

export async function validatorFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = config.validatorTimeoutMs,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(config.validatorApiUrl + path, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** GET/parse JSON from the validator; throws an error carrying `statusCode`. */
export async function validatorJson<T>(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<T> {
  const res = await validatorFetch(path, init, timeoutMs)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`validator ${res.status} on ${path}: ${body.slice(0, 200)}`) as Error & {
      statusCode?: number
    }
    err.statusCode = res.status
    throw err
  }
  return res.json() as Promise<T>
}
