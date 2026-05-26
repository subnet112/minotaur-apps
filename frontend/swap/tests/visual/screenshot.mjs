#!/usr/bin/env node
// tests/visual/screenshot.mjs
// Standalone Playwright screenshot helper.
// Usage: node screenshot.mjs <url> <outputPath> [width] [height]
//
// Clip strategy — excludes platform shell chrome that appears above
// the swap surface in the design tree app but not in our standalone app:
//
// 1. If both .app-h (platform header) and .dex-stage exist: clip from
//    the top of .dex-stage downward for (viewport_height - dex_stage_y) px.
// 2. If only .dex-stage exists (our standalone app): clip from y=0.
//    BUT to match the design tree's crop height, we record the header
//    height from a known constant (145px in the design tree) — instead
//    we simply clip the bottom N px to match. Actually, the simplest
//    normalization: use a canonical clip region that both apps share.
//
// Normalization: both apps are clipped to a fixed region.
//   - CLIP_TOP:    bottom of the tallest platform header = 145px
//                  (the design tree's .app-h is 145px tall; our app
//                   header is ~89px. We crop both from y=0 to avoid
//                   any header, using CLIP_HEIGHT = 755 for design compat.)
//   - Wait — actually we want the design tree cropped from 145 and our
//     app cropped from 89. If we use a fixed CLIP_HEIGHT of 755, then:
//       design tree: region [145, 755] = 755px tall starting at y=145
//       our app:     region [89, 755]  = 755px tall starting at y=89
//     Still different content. We need BOTH to start from the same
//     RELATIVE position within their respective swap surfaces.
//
// Final strategy: clip both to the .dex-stage element's own bounds,
// but cap at the viewport height to prevent scroll-height issues.
// The .dex-stage element in both apps encloses exactly the swap surface.
// The design tree's .dex-stage starts at y=145; ours at y=89. Since we
// clip from dex-stage's top in both cases, the CONTENT is comparable.
// The only issue is height: the design tree has MORE content mocked so
// the dex-stage is taller.
//
// Resolution: clip from dex-stage.y to min(dex-stage.y + viewport_height, page_height).
// Both captures use `height` (viewport) as the clip height, so both
// captures are always the same fixed height regardless of page content.

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

// Fixed clip height used for BOTH baseline (design tree) and current (our app).
// The design tree's .dex-stage starts at y=145 (platform header height).
// Clipping 755px from that point fills a standard 900px viewport.
// Our app's .dex-stage starts at y=89 (our smaller header). We still clip
// 755px so that BOTH images are identically sized at 1440×755.
const CLIP_HEIGHT = 755

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

  // Find .dex-stage's top edge so we can crop from there, excluding any
  // platform shell chrome that sits above it in the design tree.
  const stageEl = page.locator('.dex-stage').first()
  const stageCount = await stageEl.count()

  if (stageCount > 0) {
    const box = await stageEl.boundingBox()
    if (box) {
      const clipY = Math.round(box.y)
      // Always use fixed CLIP_HEIGHT so baseline and current are identically sized
      await page.screenshot({
        path: outputPath,
        fullPage: false,
        clip: {
          x: 0,
          y: clipY,
          width,
          height: CLIP_HEIGHT,
        },
      })
      console.log(`OK: ${outputPath} (clipped .dex-stage @y=${clipY}, h=${CLIP_HEIGHT})`)
    } else {
      await page.screenshot({ path: outputPath, fullPage: false, clip: { x: 0, y: 0, width, height: CLIP_HEIGHT } })
      console.log(`OK: ${outputPath} (fallback: dex-stage no bbox)`)
    }
  } else {
    // No .dex-stage found — take viewport screenshot from y=0
    await page.screenshot({ path: outputPath, fullPage: false, clip: { x: 0, y: 0, width, height: CLIP_HEIGHT } })
    console.log(`OK: ${outputPath} (fallback: no .dex-stage found)`)
  }
} finally {
  await browser.close()
}
