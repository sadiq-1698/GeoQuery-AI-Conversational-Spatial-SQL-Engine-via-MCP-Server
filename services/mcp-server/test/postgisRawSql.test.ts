import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_RESULT_ROWS } from "../src/sql/allowlist.js";
import { createPostgisRawSqlHandler } from "../src/tools/postgisRawSql.js";
import { createMockDb } from "./mockDb.js";

function parseBody(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0]!.text!);
}

test("rejects a malicious query without ever calling the database", async () => {
  const db = createMockDb(() => {
    throw new Error("query should not have been called");
  });
  const handler = createPostgisRawSqlHandler(db);

  const result = await handler({ sql: "SELECT * FROM osm_pois; DROP TABLE osm_pois;" });

  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text!, /^Rejected:/);
  assert.equal(db.calls.length, 0);
});

test("runs a valid query through the database with params passed through unchanged", async () => {
  const db = createMockDb(() => [{ category: "hospital", count: 3 }]);
  const handler = createPostgisRawSqlHandler(db);

  const result = await handler({
    sql: "SELECT category, COUNT(*) AS count FROM osm_pois WHERE region = $1 GROUP BY category",
    params: ["seattle-wa"],
  });

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0]!.params, ["seattle-wa"]);
  assert.match(db.calls[0]!.sql, /LIMIT 200/);

  const body = parseBody(result);
  assert.equal(body.row_count, 1);
  assert.equal(body.truncated, false);
  assert.equal(body.rows[0].category, "hospital");
});

test("truncates results beyond MAX_RESULT_ROWS even if more rows come back", async () => {
  const manyRows = Array.from({ length: MAX_RESULT_ROWS + 50 }, (_, i) => ({ id: i }));
  const db = createMockDb(() => manyRows);
  const handler = createPostgisRawSqlHandler(db);

  const result = await handler({ sql: "SELECT * FROM osm_pois" });

  const body = parseBody(result);
  assert.equal(body.rows.length, MAX_RESULT_ROWS);
  assert.equal(body.row_count, MAX_RESULT_ROWS);
  assert.equal(body.truncated, true);
});

test("does not report truncation when the row count is exactly at the cap", async () => {
  const exactRows = Array.from({ length: MAX_RESULT_ROWS }, (_, i) => ({ id: i }));
  const db = createMockDb(() => exactRows);
  const handler = createPostgisRawSqlHandler(db);

  const result = await handler({ sql: "SELECT * FROM osm_pois" });

  assert.equal(parseBody(result).truncated, false);
});

test("an empty params array is passed through, not defaulted away", async () => {
  const db = createMockDb(() => []);
  const handler = createPostgisRawSqlHandler(db);

  await handler({ sql: "SELECT * FROM osm_pois", params: [] });

  assert.deepEqual(db.calls[0]!.params, []);
});

test("omitted params defaults to an empty array for the db call", async () => {
  const db = createMockDb(() => []);
  const handler = createPostgisRawSqlHandler(db);

  await handler({ sql: "SELECT * FROM osm_pois" });

  assert.deepEqual(db.calls[0]!.params, []);
});
