import { defineConfig } from 'tsup'

// Bundle the app (incl. the generated token snapshots) into a single ESM file.
// Node deps stay external and are installed in the runtime image.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  sourcemap: true,
  skipNodeModulesBundle: true,
})
