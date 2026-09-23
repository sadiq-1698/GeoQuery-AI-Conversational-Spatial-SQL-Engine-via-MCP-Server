import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_RESULT_ROWS, validateReadOnlySql } from "../src/sql/allowlist.js";

// Formalizes the battery manually run against Session 7's implementation
// (31 cases, all passing) into real assertions. This is the highest-value
// test in the project: postgis_raw_sql is the one tool that executes an
// LLM-supplied SQL string, and this guard is the application-level layer
// under which the geoquery_ro role's own DB-level enforcement sits.

const ACCEPT_CASES: Array<[string, string]> = [
  ["simple select", "SELECT * FROM osm_pois WHERE region = $1"],
  ["select with existing limit", "SELECT id FROM osm_pois LIMIT 5"],
  [
    "join both allowed tables",
    "SELECT p.id FROM osm_pois p JOIN census_block_groups c ON ST_Contains(c.geom, p.geom)",
  ],
  ["quoted table name", 'SELECT * FROM "osm_pois"'],
  ["public-schema-qualified table", "SELECT * FROM public.osm_pois"],
  ["trailing semicolon stripped", "SELECT * FROM osm_pois;"],
  ["leading/trailing whitespace", "   SELECT * FROM osm_pois   "],
  [
    "cte referencing allowed table",
    "WITH r AS (SELECT * FROM osm_pois WHERE region = $1) SELECT category, COUNT(*) FROM r GROUP BY category",
  ],
  ["multi-cte", "WITH a AS (SELECT * FROM osm_pois), b AS (SELECT * FROM a) SELECT * FROM b"],
  ["case insensitive select", "select * from osm_pois"],
];

const REJECT_CASES: Array<[string, string]> = [
  ["stacked query", "SELECT * FROM osm_pois; DROP TABLE osm_pois;"],
  ["stacked query no trailing semicolon on first", "SELECT 1; DROP TABLE osm_pois"],
  ["insert", "INSERT INTO osm_pois (id) VALUES (1)"],
  ["update", "UPDATE osm_pois SET name = 'x'"],
  ["delete", "DELETE FROM osm_pois"],
  ["drop table", "DROP TABLE osm_pois"],
  ["truncate", "TRUNCATE osm_pois"],
  ["cte hiding delete", "WITH d AS (DELETE FROM osm_pois RETURNING *) SELECT * FROM d"],
  ["cte hiding update", "WITH u AS (UPDATE osm_pois SET name='x' RETURNING *) SELECT * FROM u"],
  ["select into", "SELECT * INTO evil_table FROM osm_pois"],
  ["line comment hiding payload", "SELECT * FROM osm_pois -- ; DROP TABLE osm_pois"],
  ["block comment", "SELECT * FROM osm_pois /* sneaky */ WHERE region = $1"],
  ["disallowed table", "SELECT * FROM pg_catalog.pg_tables"],
  ["disallowed table no schema", "SELECT * FROM users"],
  ["disallowed table via join", "SELECT * FROM osm_pois JOIN users ON true"],
  ["not a select at all", "EXECUTE some_proc()"],
  ["grant", "GRANT SELECT ON osm_pois TO PUBLIC"],
  ["vacuum", "VACUUM osm_pois"],
  ["empty string", ""],
  ["whitespace only", "   "],
  ["do block", "DO $$ BEGIN DELETE FROM osm_pois; END $$"],
];

for (const [description, sql] of ACCEPT_CASES) {
  test(`accepts: ${description}`, () => {
    const result = validateReadOnlySql(sql);
    assert.equal(result.ok, true, result.error);
  });
}

for (const [description, sql] of REJECT_CASES) {
  test(`rejects: ${description}`, () => {
    const result = validateReadOnlySql(sql);
    assert.equal(result.ok, false, `expected rejection but got sql: ${result.sql}`);
  });
}

test("appends LIMIT when missing", () => {
  const result = validateReadOnlySql("SELECT * FROM osm_pois WHERE region = $1");
  assert.equal(result.sql, `SELECT * FROM osm_pois WHERE region = $1 LIMIT ${MAX_RESULT_ROWS}`);
});

test("preserves an existing LIMIT rather than overriding it", () => {
  const result = validateReadOnlySql("SELECT * FROM osm_pois LIMIT 5");
  assert.equal(result.sql, "SELECT * FROM osm_pois LIMIT 5");
});

test("strips exactly one trailing semicolon, not more", () => {
  const result = validateReadOnlySql("SELECT * FROM osm_pois;;");
  // A second semicolon after the first is stripped one is still a second
  // statement separator and must be rejected, not silently dropped.
  assert.equal(result.ok, false);
});
