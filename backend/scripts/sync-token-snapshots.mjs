#!/usr/bin/env node
/**
 * Copy the frontend's bundled token snapshots into the backend as the single
 * source of truth for balance discovery. The backend checks the SAME token set
 * the swap selector shows, so balances and the selector never disagree.
 *
 * Run from the repo checkout (needs the sibling frontend source — NOT available
 * inside the Docker build, which is why the copies are committed):
 *
 *   node backend/scripts/sync-token-snapshots.mjs
 *   # or: pnpm --dir backend sync:tokens
 *
 * Re-run whenever frontend/swap/src/config/{ethereum,aerodrome-base}-tokens.ts
 * change (e.g. after a snapshot refresh), then commit the regenerated files.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const srcDir = resolve(repoRoot, 'frontend', 'swap', 'src', 'config')
const outDir = resolve(here, '..', 'src', 'tokens', 'generated')

const files = ['ethereum-tokens.ts', 'aerodrome-base-tokens.ts']
const banner =
  '// GENERATED — do not edit. Copied from frontend/swap/src/config by\n' +
  '// backend/scripts/sync-token-snapshots.mjs. Re-run after a snapshot refresh.\n\n'

for (const f of files) {
  const body = readFileSync(resolve(srcDir, f), 'utf8')
  writeFileSync(resolve(outDir, f), banner + body)
  console.log(`synced ${f} -> src/tokens/generated/${f}`)
}
