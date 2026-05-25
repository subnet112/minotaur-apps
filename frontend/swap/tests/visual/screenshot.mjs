#!/usr/bin/env node
// tests/visual/screenshot.mjs
// Standalone Playwright screenshot helper.
// Usage: node screenshot.mjs <url> <outputPath> [width] [height]
// Uses the Chromium browser from pagewire's playwright installation.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve playwright from pagewire's node_modules (the env that has it installed)
const PAGEWIRE_ROOT = '/workspaces/minotaur-apps/pagewire-main'
const require = createRequire(import.meta.url)

// Dynamically find and load playwright
const playwrightPath = path.join(
  PAGEWIRE_ROOT,
  'node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js'
)

const pw = await import(playwrightPath)
// playwright's ESM export wraps the instance as .default; chromium lives on it
const { chromium } = pw.default ?? pw

const [,, url, outputPath, widthStr, heightStr] = process.argv
if (!url || !outputPath) {
  console.error('Usage: node screenshot.mjs <url> <outputPath> [width] [height]')
  process.exit(1)
}

const width = parseInt(widthStr ?? '1440', 10)
const height = parseInt(heightStr ?? '900', 10)

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    viewport: { width, height },
  })
  const page = await context.newPage()
  // Use domcontentloaded so SPA dev servers with polling/WS don't timeout.
  // Then wait for the first paint to settle.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  // Give React time to render initial state
  await page.waitForTimeout(800)
  // Wait two animation frames for any CSS transitions to settle
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.screenshot({ path: outputPath, fullPage: false })
  console.log(`OK: ${outputPath}`)
} finally {
  await browser.close()
}
