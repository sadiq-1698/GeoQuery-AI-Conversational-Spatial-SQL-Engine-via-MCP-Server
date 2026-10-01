# apps/web

Next.js 16 (App Router) frontend: chat UI + MapLibre GL JS map, and the
backend API route that runs the Claude tool-use agent loop.

```bash
npm install                          # from the repo root (npm workspaces)
cp ../../.env.example ../../.env     # fill in ANTHROPIC_API_KEY, MCP_DATABASE_URL, etc.
npm run --workspace services/mcp-server build   # mcp-client.ts spawns the built dist/index.js
npm run --workspace @geoquery/web typecheck
npm run --workspace @geoquery/web dev     # http://localhost:3000
npm run --workspace @geoquery/web build
```

`next.config.ts` loads that root `.env` explicitly (see the comment there) —
Next's own env loading only reads `.env*` files from this directory, not a
parent one, and this repo has kept a single `.env` at the monorepo root
since Session 1.

## Status

- `app/layout.tsx` + `app/globals.css` — root layout, metadata, base styling
  (system font stack, light/dark via `prefers-color-scheme`).
- `app/page.tsx` + `app/page.module.css` — split-pane skeleton (chat pane
  left, map pane right, stacking vertically on narrow screens).
- **`components/MapView.tsx` + `lib/mapLayers.ts`** — a MapLibre GL map on
  OpenFreeMap's free vector basemap. Renders an optional `layers` prop
  (GeoJSON `FeatureCollection`s keyed by source id) as colored points (by
  category) and translucent polygons, with a click-to-popup on point
  features, and flies the camera to a layer's bounds the first time it
  appears.
- **`components/ChatPanel.tsx` + `MessageBubble.tsx`** — message list +
  composer (Enter to send, Shift+Enter for a newline), wired to
  `lib/mockAssistant.ts` for now: keyword-matched canned replies (try
  "hospital" or "...within 10 minutes") standing in for the real Claude
  agent loop. `page.tsx` lifts only the `layers` state ChatPanel's replies
  populate — the chat transcript itself stays local to ChatPanel.
- **`lib/mcp-client.ts`** — `getMcpClient()` spawns `services/mcp-server`'s
  built `dist/index.js` as a child process and connects to it over stdio,
  once, caching the connection on `globalThis` (survives Next.js dev-mode
  Fast Refresh re-executing this module without spawning a duplicate
  server). The child process env is the MCP SDK's own safe default subset
  plus `MCP_DATABASE_URL` only — never the full `process.env`, which would
  also hand the MCP server this process's `ANTHROPIC_API_KEY` and admin
  `DATABASE_URL`.
- **`lib/anthropic-tools.ts`** — `listAnthropicTools()` maps the MCP
  server's `listTools()` output to Anthropic's `tools` API parameter
  (`inputSchema` → `input_schema`; both are plain JSON Schema, so nothing
  else changes).
- **`lib/agent-loop.ts`** — `runAgentLoop()`: the manual Claude tool-use
  loop (call the model, run any tool_use blocks against the MCP server,
  feed tool_result blocks back, repeat until the model stops for a reason
  other than "tool_use"), plus the system prompt (prefer the structured
  tools, require a `region`, the `isochrone_query` honesty caveat, and an
  output contract that keeps the model from reconstructing GeoJSON in
  prose). Dependency-injected (`anthropic`, `mcpClient` both passed in) so
  it's testable without a live API key — see the file's top comment for a
  real TypeScript-inference quirk in the MCP SDK's `callTool()` return type
  that's worth knowing about if you touch this file.
- **`app/api/chat/route.ts`** — `POST /api/chat` streams newline-delimited
  JSON events (`text`, `geojson`, `done` with the full message history,
  `error`) as `runAgentLoop` runs. Stateless: the client resends the full
  `Anthropic.MessageParam[]` history (including tool_use/tool_result
  blocks) it got back from the last `done` event — there's no server-side
  session store. `export const runtime = "nodejs"` since `mcp-client.ts`
  spawns a child process, which can't run on Edge.
- Live wiring — replacing `mockAssistant.ts` with real calls to this route
  (Session 15) — is what's left.

### Workarounds / gotchas worth knowing about

**Relative imports in `apps/web` must be extensionless** (`from "./foo"`,
not `from "./foo.js"`). `services/mcp-server` uses NodeNext module
resolution, where the `.js` extension is required even for `.ts` source —
easy to carry that habit over, and both `tsc` and `tsx` accept it here
without complaint. But apps/web uses bundler resolution, and Turbopack does
*not* perform that NodeNext-style mapping for relative imports — it only
surfaces as "Module not found" when the file is actually built into a
route, not at typecheck time. (Happened once already, in `lib/agent-loop.ts`
— see its fix commit.)

`scripts/copy-maplibre-worker.mjs` copies maplibre-gl's tile-parsing worker
out of `node_modules` into `public/` on every install/dev/build. Turbopack
doesn't rewrite the `new URL(..., import.meta.url)` reference maplibre-gl
uses internally to load that worker when it's inside a dependency (rather
than first-party source), so without this the worker 404s at runtime and
every map falls back to slower main-thread tile parsing with a console
error on every load — confirmed with a real browser, not assumed. If a
future maplibre-gl upgrade changes its internal worker/chunk filenames,
update the file list in that script to match.

## A note on Next.js's AGENTS.md

`AGENTS.md` (and `CLAUDE.md`, which just includes it) are generated by
`create-next-app`/`next dev` itself, not hand-written — Next.js proactively
warns coding agents that its API may differ from what's in their training
data and points at the locally-installed docs
(`node_modules/next/dist/docs/`) to check before writing code. Worth
reading if something here looks unfamiliar; this project hit exactly that
with the `LayoutProps<>` helper (see `app/layout.tsx`'s comment).
