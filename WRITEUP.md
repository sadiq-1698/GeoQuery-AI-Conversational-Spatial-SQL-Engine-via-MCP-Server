# Notes for the portfolio write-up

Design decisions and real findings worth talking about, with pointers to
where each one actually lives in the code — written so a reader can verify
any claim here rather than take it on faith.

## The isochrone tradeoff: straight-line buffer, not routed travel time

`isochrone_query` answers "what's reachable within N minutes" with a
straight-line distance buffer (`radius = minutes * 60 * speed`, walking
~4.5 km/h, driving ~30 km/h), not a real road-network shortest-path
isochrone. A true routed isochrone needs pgRouting and a routable road
graph — meaningfully more ingestion complexity (building a topologically
correct graph from OSM ways, handling one-way streets, turn restrictions)
for a demo whose point is the MCP/agent architecture, not routing fidelity.

What makes this defensible rather than just a shortcut: the approximation
is never hidden. The tool's own description
(`services/mcp-server/src/index.ts`) tells the calling model this is
approximate; the returned GeoJSON polygon carries an `approximation` string
in its properties explaining exactly how it differs from reality (worse
near water, highways, or a sparse street grid); and the system prompt
requires the model to pass that caveat on to the user. The honesty is
structural, not a hope that the model remembers to mention it.

The clean part: swapping in pgRouting later only touches
`services/mcp-server/src/sql/queries.ts`'s SQL for this one tool — the
input/output shape (`center_lon`/`center_lat`/`minutes`/`mode`/`region` in,
a FeatureCollection with an isochrone polygon + intersecting features out)
doesn't change, so the MCP interface boundary absorbs a routing-fidelity
upgrade without touching the agent loop, the frontend, or the tool schema.

## MCP tool schemas are (almost) free Anthropic tool definitions

Both the Model Context Protocol and Anthropic's Messages API tool-use
feature describe a tool's inputs as JSON Schema, which means a schema
written once for MCP (`services/mcp-server/src/schemas/toolSchemas.ts`,
authored as Zod "raw shapes" for `McpServer.registerTool()`) converts to
Anthropic's `{name, description, input_schema}` tool shape as a near-1:1
mapping (`apps/web/lib/anthropic-tools.ts`) rather than a hand-maintained
parallel definition. A tool's constraints — `category` is one of eight
enum values, `radius_meters` maxes at 50km, `minutes` is capped at 60 — are
enforced once, at the MCP boundary, and the same constraints are what the
LLM sees when deciding how to call the tool, not a separate client-side
guess at what's allowed.

This also means the MCP server and the Next.js app can be developed and
tested independently (confirmed for real: `services/mcp-server` has its own
automated test suite exercising all three tools against a mocked database,
with zero dependency on apps/web or a running Anthropic client) and still
compose correctly, because both sides speak the same schema language rather
than each inventing a tool-calling convention.

## Security: layered, not just applied once

`postgis_raw_sql` is the one tool that lets an LLM's generated text become
part of a real SQL query, which is the highest-risk surface in the whole
app. It's defended in layers, deliberately redundant rather than relying on
any single check being perfect:

1. **Application-level guard** (`services/mcp-server/src/sql/allowlist.ts`):
   single-statement only, anchored to `SELECT`/`WITH`, a keyword blacklist
   scanned across the *whole* string (so a CTE can't smuggle in a `DELETE`),
   a table allowlist, no comments, forced `LIMIT`. Explicitly documented as
   a regex-based guard, not a full SQL parser — a known, stated limitation
   rather than a false guarantee.
2. **Database-level backstop** (`db/schema/004_roles.sh`): the `geoquery_ro`
   role the MCP server connects as has `SELECT`-only grants, no
   `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` ever, `default_transaction_read_only
   = on`, and a 5s `statement_timeout`. Even a complete bypass of layer 1
   still can't produce a write or an unbounded query — confirmed for real in
   Session 17 by calling the tool through a live MCP client and watching a
   real `DELETE` attempt get rejected by the SQL guard before it ever
   reached Postgres.
3. **Client-side timeout** (`services/mcp-server/src/tools/postgisRawSql.ts`):
   an 8s JS-level guard on top of the DB's own 5s timeout, catching a
   hung connection/driver stall that a server-side `statement_timeout`
   wouldn't.

Two credential paths reinforce the same boundary structurally: `DATABASE_URL`
(admin, used only by migrations/ingestion scripts) and `MCP_DATABASE_URL`
(the read-only role, the *only* thing the MCP server — and therefore the
chat-facing code path — ever holds a connection string for). The chat path
is incapable of issuing a write, not just disciplined not to.

## What building this for real actually surfaced

The most interesting bugs weren't in the parts that looked risky on paper
(the SQL guard, the agent loop) — they were in the data pipeline, and only
showed up once it ran against real data at real scale:

- osm2pgsql's flex Lua API in the actually-installed version had no
  `as_point()`/`as_polygon()` method at all, despite that being a reasonable
  assumption from reading older docs — geometry only auto-populates when an
  OSM object's type matches the target column's geometry type exactly.
- `osm2pgsql --create` silently drops and recreates *any* table its Lua
  script defines, including a pre-provisioned one with a completely
  different schema — not documented prominently, and only obvious after it
  had already destroyed a real table's primary key and indexes once.
- A GIST index on a `geometry` column doesn't get used by a query that casts
  to `geography` for its distance check — confirmed with `EXPLAIN ANALYZE`
  against 282k real rows (a ~170ms sequential scan), fixed with a second,
  functional GIST index built on the geography cast itself (~8ms after).
- An ingestion script with no `ON CONFLICT` handling worked fine right up
  until two regions' real data actually overlapped by primary key for the
  first time — and because the surrounding `DELETE`+`INSERT` weren't
  wrapped in a transaction, the failure mode wasn't just "the insert fails,"
  it was "the existing rows are already gone by the time it fails."

None of these would have been caught by typechecking, unit tests against
mocked data, or careful code review alone — they needed a real Docker
Postgres, real multi-million-row OSM extracts, and actually running the
pipeline twice with overlapping inputs. That's the core argument for why
Sessions 17-19 existed as a dedicated phase rather than being folded into
earlier sessions: building against a mock is necessary but not sufficient,
and the bugs that survive to look for are specifically the ones a mock
can't produce.
