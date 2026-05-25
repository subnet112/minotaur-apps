import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { ToastVariant } from '@/types'

/**
 * ToastViewport — 00.16. Custom implementation (no Sonner) per shell
 * audit Q7 resolution.
 *
 *   - 5 variants (success / error / info / loading / transient)
 *   - bottom-right anchored, 360px wide
 *   - max 3 visible, newest on top, 12px gap
 *   - per-variant dwell timing: 4s default, 7s error, 2s transient, sticky for loading
 *   - hover pauses the timer + bar; mouseleave resumes
 *   - progress bar driven by CSS custom property `--p` (1 → 0 over dwell)
 *   - entry/exit animations via .is-entering / .is-exiting classes
 *   - click anywhere except the action button or dismiss dismisses
 *   - aria-live="polite" on success/info; aria-live="assertive" on error
 *
 * Usage:
 *
 *   const toast = useToast()
 *   toast.success({ title: 'Order #abc12 submitted' })
 *   toast.error({ title: 'Submit failed', message: 'Solver gateway 502' })
 *   toast.transient({ title: 'Hash copied · 0x9a3f…e21c' })
 *
 *   // Promise integration — loading → success/error
 *   const id = toast.loading({ title: 'Deploying app intent…' })
 *   try {
 *     await deploy()
 *     toast.update(id, { variant: 'success', title: 'App deployed', dwellMs: 4000 })
 *   } catch (err) {
 *     toast.update(id, { variant: 'error', title: 'Deploy failed', dwellMs: 7000 })
 *   }
 */

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface ToastAction {
  /** Visible button label */
  label: string
  /** Fired when the user clicks the action. Toast auto-dismisses after. */
  onAction: () => void
  /** Optional arrow glyph in the design (default true) */
  arrow?: boolean
}

export interface ToastInput {
  variant?: ToastVariant
  /** Eyebrow: small mono prefix above the title (e.g. ["Order", "Submitted"]) */
  eyebrow?: [string, string]
  /** Required — the bold line */
  title: ReactNode
  /** Optional secondary line in mist */
  message?: ReactNode
  /** Optional foot timestamp (HH:MM:SS). Auto-formatted from `new Date()` if `true`. */
  timestamp?: string | true
  action?: ToastAction
  /**
   * Override dwell (ms). Defaults per variant:
   *   success/info: 4000
   *   error:        7000
   *   transient:    2000
   *   loading:      Infinity (sticky)
   */
  dwellMs?: number
}

interface ToastInstance extends Omit<ToastInput, 'variant' | 'dwellMs'> {
  id: string
  /** Resolved (required after `resolveInput`) */
  variant: ToastVariant
  /** Resolved dwell (after defaults applied) */
  dwellMs: number
  /** When `is-exiting` class is applied (queued for removal) */
  exiting: boolean
}

export type ToastId = string

interface ToastApi {
  success: (input: Omit<ToastInput, 'variant'>) => ToastId
  error: (input: Omit<ToastInput, 'variant'>) => ToastId
  info: (input: Omit<ToastInput, 'variant'>) => ToastId
  loading: (input: Omit<ToastInput, 'variant' | 'dwellMs'>) => ToastId
  transient: (input: Omit<ToastInput, 'variant' | 'action' | 'message' | 'eyebrow' | 'timestamp' | 'dwellMs'>) => ToastId
  dismiss: (id: ToastId) => void
  /** Replace any field on an existing toast (used for promise integration). */
  update: (id: ToastId, patch: Partial<ToastInput>) => void
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MAX_VISIBLE = 3
/** Matches --dur-state from tokens.css (200ms) */
const ANIMATION_MS = 200

const DEFAULT_DWELL: Record<ToastVariant, number> = {
  success: 4000,
  error: 7000,
  info: 4000,
  loading: Infinity,
  transient: 2000,
}

// ----------------------------------------------------------------------------
// Context
// ----------------------------------------------------------------------------

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // No-op fallback so components can call useToast() even if the provider
    // isn't mounted (during Suspense fallback, test envs, etc.).
    const noop = () => 'noop'
    return {
      success: noop,
      error: noop,
      info: noop,
      loading: noop,
      transient: noop,
      dismiss: () => {},
      update: () => {},
    }
  }
  return ctx
}

// ----------------------------------------------------------------------------
// Provider
// ----------------------------------------------------------------------------

let toastIdCounter = 0
const nextId = () => `toast-${++toastIdCounter}-${Date.now()}`

function fmtTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function resolveInput(input: ToastInput): ToastInstance {
  const variant = input.variant ?? 'info'
  return {
    ...input,
    variant,
    id: nextId(),
    dwellMs: input.dwellMs ?? DEFAULT_DWELL[variant],
    timestamp: input.timestamp === true ? fmtTimestamp() : input.timestamp,
    exiting: false,
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastInstance[]>([])

  const push = useCallback((input: ToastInput): ToastId => {
    const instance = resolveInput(input)
    setToasts((prev) => {
      // Enforce max visible — drop oldest if at cap
      const trimmed = prev.length >= MAX_VISIBLE ? prev.slice(0, MAX_VISIBLE - 1) : prev
      return [instance, ...trimmed]
    })
    return instance.id
  }, [])

  const dismiss = useCallback((id: ToastId) => {
    // Mark exiting first so the animation plays, then remove after ANIMATION_MS
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    )
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, ANIMATION_MS)
  }, [])

  const update = useCallback((id: ToastId, patch: Partial<ToastInput>) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const merged: ToastInstance = { ...t, ...patch }
        // Re-resolve dwell if variant changed and dwell wasn't explicitly set
        if (patch.variant && patch.dwellMs === undefined) {
          merged.dwellMs = DEFAULT_DWELL[patch.variant]
        }
        if (patch.timestamp === true) merged.timestamp = fmtTimestamp()
        return merged
      })
    )
  }, [])

  const api = useMemo<ToastApi>(() => ({
    success: (input) => push({ ...input, variant: 'success' }),
    error:   (input) => push({ ...input, variant: 'error' }),
    info:    (input) => push({ ...input, variant: 'info' }),
    loading: (input) => push({ ...input, variant: 'loading' }),
    transient: (input) => push({ ...input, variant: 'transient' }),
    dismiss,
    update,
  }), [push, dismiss, update])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// ----------------------------------------------------------------------------
// Viewport (portal target + stack host)
// ----------------------------------------------------------------------------

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastInstance[]
  onDismiss: (id: ToastId) => void
}) {
  if (toasts.length === 0) return null

  return createPortal(
    <div
      className="app-toast-stack-host"
      role="region"
      aria-label="Notifications"
      style={{
        position: 'fixed',
        bottom: 22,
        right: 22,
        top: 'auto',
        left: 'auto',
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body
  )
}

// ----------------------------------------------------------------------------
// Single toast
// ----------------------------------------------------------------------------

function Toast({ toast, onDismiss }: { toast: ToastInstance; onDismiss: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isHover, setIsHover] = useState(false)
  const [isEntering, setIsEntering] = useState(true)

  // Strip the entry animation class after one tick
  useEffect(() => {
    const t = window.setTimeout(() => setIsEntering(false), ANIMATION_MS)
    return () => window.clearTimeout(t)
  }, [])

  // Drive --p from 1 → 0 over dwell. Pause on hover. Loading variant skips.
  useEffect(() => {
    const sticky = toast.dwellMs === Infinity || toast.variant === 'loading'
    const el = rootRef.current
    if (!el || sticky) return

    let rafId: number | null = null
    let startedAt = performance.now()
    let elapsedAtPause = 0
    let dismissed = false

    const tick = (now: number) => {
      if (dismissed) return
      if (isHover) {
        // Paused — stop ticking, remember elapsed
        elapsedAtPause = now - startedAt
        return
      }
      const elapsed = now - startedAt
      const ratio = Math.max(0, 1 - elapsed / toast.dwellMs)
      el.style.setProperty('--p', String(ratio))
      if (elapsed >= toast.dwellMs) {
        dismissed = true
        onDismiss()
        return
      }
      rafId = requestAnimationFrame(tick)
    }

    if (isHover) {
      // Paused on first render? Just don't start the loop.
    } else {
      // Resume from paused state if we have one
      if (elapsedAtPause > 0) {
        startedAt = performance.now() - elapsedAtPause
        elapsedAtPause = 0
      }
      rafId = requestAnimationFrame(tick)
    }

    return () => {
      dismissed = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [isHover, toast.dwellMs, toast.variant, onDismiss])

  // Click anywhere (except action button or dismiss button) dismisses
  function onRootClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('.app-toast-action') || target.closest('.app-toast-dismiss')) {
      return
    }
    onDismiss()
  }

  const variantClass = `app-toast--${toast.variant}`
  const stateClasses = [
    isEntering && 'is-entering',
    toast.exiting && 'is-exiting',
    isHover && 'is-hover',
  ]
    .filter(Boolean)
    .join(' ')

  const ariaLive = toast.variant === 'error' ? 'assertive' : 'polite'
  const role = toast.variant === 'error' ? 'alert' : 'status'

  const isTransient = toast.variant === 'transient'
  const isLoading = toast.variant === 'loading'

  return (
    <div
      ref={rootRef}
      className={['app-toast', variantClass, stateClasses].filter(Boolean).join(' ')}
      role={role}
      aria-live={ariaLive}
      style={{ ['--p' as string]: '1' }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      onClick={onRootClick}
    >
      <BracketCorners />
      <div className="app-toast-head">
        <span className="app-toast-icon" aria-hidden="true">
          {iconForVariant(toast.variant)}
        </span>
        <div className="app-toast-copy">
          {!isTransient && toast.eyebrow && (
            <span className="app-toast-eyebrow">
              <span>{toast.eyebrow[0]}</span>
              <span className="slash">/</span>
              <span className="v">{toast.eyebrow[1]}</span>
            </span>
          )}
          <p className="app-toast-title">{toast.title}</p>
          {!isTransient && toast.message && (
            <p className="app-toast-msg">{toast.message}</p>
          )}
        </div>
        <button
          type="button"
          className="app-toast-dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
          </svg>
        </button>
      </div>
      {!isTransient && (toast.timestamp || toast.action) && (
        <div className={['app-toast-foot', toast.action && !toast.timestamp && 'is-action-only'].filter(Boolean).join(' ')}>
          {toast.timestamp && (
            <span className="app-toast-ts">
              {typeof toast.timestamp === 'string' ? toast.timestamp : ''}
            </span>
          )}
          {toast.action && (
            <button
              type="button"
              className="app-toast-action"
              onClick={() => { toast.action!.onAction(); onDismiss() }}
            >
              <span>{toast.action.label}</span>
              {toast.action.arrow !== false && <span className="arr">→</span>}
            </button>
          )}
        </div>
      )}
      {!isTransient && !isLoading && (
        <span className="app-toast-progress" aria-hidden="true" />
      )}
    </div>
  )
}

function iconForVariant(variant: ToastVariant): ReactNode {
  switch (variant) {
    case 'success':
    case 'transient':
      return (
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 7.5 L5.5 10.5 L11.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" fill="none" />
        </svg>
      )
    case 'error':
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
        </svg>
      )
    case 'info':
      return (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <rect x="0" y="0" width="8" height="8" fill="currentColor" />
        </svg>
      )
    case 'loading':
      return <span className="app-toast-spinner" aria-hidden="true" />
  }
}
