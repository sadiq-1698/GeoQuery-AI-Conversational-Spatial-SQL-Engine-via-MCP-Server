#!/usr/bin/env node
// maplibre-gl's tile-parsing worker is loaded via
// `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))` inside
// its own pre-built dist bundle — a pattern bundlers normally rewrite so the
// referenced file gets emitted alongside the importing chunk. As of this
// project's Next.js 16 + Turbopack version, that rewrite doesn't reach into
// node_modules dependencies, so the worker file 404s at runtime and
// maplibre-gl falls back to unparallelized main-thread tile parsing with a
// console error every time (confirmed via Playwright: map still renders,
// but with a "Worker failed to load" error on every load).
//
// Fix: serve the worker as a plain static file instead of relying on
// bundler URL-rewriting at all. Copies it (and the sibling chunk it
// imports) from node_modules into public/, where MapView.tsx points
// maplibregl.setWorkerUrl() at it directly. Runs on postinstall/predev/
// prebuild so it's always in sync with whatever maplibre-gl version
// package-lock.json actually resolved — output isn't committed (see
// .gitignore) since it's just a copy of installed-package content.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Resolved via require.resolve rather than a hardcoded relative path up to
// node_modules — correct whether npm workspaces hoists maplibre-gl to the
// repo root or nests it under apps/web/node_modules.
const require = createRequire(import.meta.url);
const maplibrePackageJson = require.resolve("maplibre-gl/package.json");
const srcDir = join(dirname(maplibrePackageJson), "dist");
const destDir = join(here, "..", "public", "maplibre-gl");

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(destDir, { recursive: true });
for (const file of files) {
  const src = join(srcDir, file);
  if (!existsSync(src)) {
    console.error(`copy-maplibre-worker: ${src} not found — is maplibre-gl installed?`);
    process.exit(1);
  }
  copyFileSync(src, join(destDir, file));
}
console.log(`copy-maplibre-worker: copied ${files.join(", ")} to public/maplibre-gl/`);
