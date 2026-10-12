# Live demo script

A scripted sequence of prompts for demoing GeoQuery AI against the real
`bellingham-wa` demo dataset (6,270 POIs, 64 census block groups — see
[db/ingest/README.md](db/ingest/README.md) for how it was ingested). Each
prompt is chosen to exercise a specific tool or behavior, using real places
that actually exist in the ingested data (not made up) so the answers are
grounded in something you can double-check.

Prerequisites: `docker compose up -d` with data ingested (steps 1-2 of the
root README), a real `ANTHROPIC_API_KEY` in `.env`, and
`npm run --workspace @geoquery/web dev` running. Say "Bellingham" or
"bellingham-wa" in your first message if the model doesn't already know
which region to search (there's no hardcoded default city in any tool —
`region` is always a required parameter the model has to supply, confirmed
by `spatial_buffer`'s/`isochrone_query`'s Zod schemas in
`services/mcp-server/src/schemas/toolSchemas.ts`).

## 1. `spatial_buffer` — basic proximity search

> **"What parks are within 2km of downtown Bellingham?"**

Exercises the simplest tool: a radius search filtered by category. Real
parks in the data include Elizabeth Park, Euclid Park, Ted Edwards Park,
and West Lake Padden Park (confirmed via a direct query against the live
table, not assumed) — the model should return a handful of these as point
features, each clickable on the map for a popup with name/category.

Follow-up, same turn's context:

> **"Now show me cafes instead, same area."**

Tests that the model re-derives a new `spatial_buffer` call with a
different `category` rather than reusing stale results, and that the map
keeps the parks layer visible (via the layer toggle list) alongside the new
cafes layer rather than replacing it.

## 2. `isochrone_query` — the approximation-aware tool

> **"What's reachable within a 15 minute walk of the Bellingham train
> station?"**

A real `transit_stop` POI named exactly "Bellingham" exists in the data at
`(-122.5122525, 48.7218238)` — the Amtrak/Greyhound station near Fairhaven.
This should produce a buffer polygon plus whatever real POIs and
block-group centroids fall inside it. **The model's answer
should explicitly say this is a straight-line approximation, not routed
walking distance** — that caveat is baked into the tool's description and
the returned polygon's `properties.approximation` field
(`services/mcp-server/src/tools/isochroneQuery.ts`), so a demo where the
model states this unprompted is itself worth pointing out as a real,
tested design decision, not a hoped-for behavior.

## 3. `postgis_raw_sql` — the escape hatch

> **"Which category of place is most common in Bellingham?"**

Neither structured tool can answer an aggregate question like this — watch
for the model reaching for `postgis_raw_sql` instead (a `SELECT category,
COUNT(*) ... GROUP BY category ORDER BY COUNT(*) DESC` query). The real
answer, confirmed directly against the `bellingham-wa` rows, is `other`
with 4,455 of the region's 6,270 total POIs, followed by `shop` (736) and
`transit_stop` (593) — a reasonable thing to probe if you want to show the
raw-SQL guard working rather than just its structured sibling tools.

Optional follow-up to show the guard rejecting something:

> **"Delete all the hospital records."**

The model should refuse outright (it has no tool for this), or if pushed
toward raw SQL, the query would be rejected by `validateReadOnlySql()`
before ever reaching the database — a good moment to point at
`services/mcp-server/src/sql/allowlist.ts` and the `geoquery_ro` role's own
read-only enforcement underneath it as the actual, tested defense (see the
root README's verified-for-real notes on this).

## 4. Known, deliberate gaps to narrate rather than hide

If a question touches population/income/housing data (e.g. "what's the
average household income near downtown?"), the honest answer is `NULL` —
the ACS join was never run for real (Census API now requires a free key;
see [db/ingest/README.md](db/ingest/README.md)). Worth demoing once to show
the app fails informatively rather than fabricating a number, not worth
avoiding out of embarrassment.

## 5. Multi-turn layer accumulation

After running a few of the prompts above, open the layer toggle list and
uncheck/recheck a couple of earlier results — this demonstrates state
that's actually been verified in a real browser (see
`apps/web/README.md`), not just asserted to work.
