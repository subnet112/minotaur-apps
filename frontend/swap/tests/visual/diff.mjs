// tests/visual/diff.mjs
// pixelmatch driver — compares baseline/*.png to current/*.png,
// writes diff/*.png for any drift, exits non-zero on any failure.
import fs from 'node:fs'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const BASE = path.resolve('tests/visual/baseline')
const CURR = path.resolve('tests/visual/current')
const DIFF = path.resolve('tests/visual/diff')

// Per-state tolerance — fraction of pixels allowed to differ. Tight on
// form chrome, looser on text-heavy modals.
const DEFAULT_TOLERANCE = 0.005
const TIGHTER_STATES = new Set(['02-metamask-idle', '04-metamask-quoted'])

fs.mkdirSync(DIFF, { recursive: true })
let failures = 0

if (!fs.existsSync(BASE)) {
  console.log(`ERROR: no baseline at ${BASE}`)
  process.exit(2)
}

const states = fs.readdirSync(BASE).filter(f => f.endsWith('.png'))
if (states.length === 0) {
  console.log(`ERROR: baseline directory empty: ${BASE}`)
  process.exit(2)
}

for (const f of states) {
  const id = f.replace(/\.png$/, '')
  const a = fs.readFileSync(path.join(BASE, f))
  const bPath = path.join(CURR, f)
  if (!fs.existsSync(bPath)) {
    console.log(`FAIL  ${id}: no current PNG`)
    failures++
    continue
  }
  const b = fs.readFileSync(bPath)
  const imgA = PNG.sync.read(a)
  const imgB = PNG.sync.read(b)
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    console.log(`FAIL  ${id}: dimension mismatch baseline=${imgA.width}x${imgA.height} current=${imgB.width}x${imgB.height}`)
    failures++
    continue
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height })
  const diffPx = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, { threshold: 0.1 })
  const total = imgA.width * imgA.height
  const ratio = diffPx / total
  const tol = TIGHTER_STATES.has(id) ? 0.001 : DEFAULT_TOLERANCE
  const verdict = ratio <= tol ? 'PASS' : 'FAIL'
  console.log(`${verdict}  ${id}: ${diffPx}px (${(ratio*100).toFixed(3)}%) tolerance=${(tol*100).toFixed(2)}%`)
  if (verdict === 'FAIL') {
    fs.writeFileSync(path.join(DIFF, f), PNG.sync.write(diff))
    failures++
  }
}

if (failures > 0) {
  console.log(`\n${failures} state(s) drifted. Diff PNGs in ${DIFF}/`)
  process.exit(1)
}
console.log('\nAll states match baseline.')
