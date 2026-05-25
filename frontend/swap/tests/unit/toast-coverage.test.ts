/**
 * Regression guard: no sonner imports in hook source. Every async hook
 * that calls toast.loading() also calls toast.update(id, ...). Catches
 * partial-revert of the toast refactor.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'hooks')

function hookFiles(): string[] {
  return readdirSync(HOOK_DIR).filter(f => f.endsWith('.ts'))
}

describe('toast coverage', () => {
  it('no hook imports from sonner', () => {
    for (const f of hookFiles()) {
      const src = readFileSync(join(HOOK_DIR, f), 'utf8')
      expect(src, `${f} should not import sonner`).not.toMatch(/from\s+['"]sonner['"]/)
    }
  })

  it('every hook that calls toast.loading also calls toast.update', () => {
    for (const f of hookFiles()) {
      const src = readFileSync(join(HOOK_DIR, f), 'utf8')
      const usesLoading = /toast\.loading\(/.test(src)
      const usesUpdate = /toast\.update\(/.test(src)
      if (usesLoading) {
        expect(usesUpdate, `${f} calls toast.loading but never toast.update — sticky pattern broken`).toBe(true)
      }
    }
  })

  it('hooks that use toast import useToast from shell', () => {
    for (const f of hookFiles()) {
      const src = readFileSync(join(HOOK_DIR, f), 'utf8')
      const usesToast = /\btoast\.(success|error|info|loading|transient|update)\(/.test(src)
      if (usesToast) {
        expect(src, `${f} uses toast but doesn't import useToast`).toMatch(
          /import\s+\{\s*useToast\s*\}\s+from\s+['"]@\/components\/shell['"]/
        )
      }
    }
  })
})
