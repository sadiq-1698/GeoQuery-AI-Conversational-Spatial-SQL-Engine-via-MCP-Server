/**
 * Defense-in-depth validation for postgis_raw_sql — the one tool that lets
 * an LLM send us a SQL string. This is a regex/string-based guard, NOT a
 * full SQL parser; it's deliberately layered under a DB-level backstop
 * (the geoquery_ro role: SELECT-only grants, default_transaction_read_only,
 * statement_timeout — see db/schema/004_roles.sh) so a bypass here still
 * can't produce a write or an unbounded query. A known limitation, not a
 * guarantee: a future hardening step would replace the table/CTE regexes
 * below with a real AST-based check (e.g. node-sql-parser).
 */

export const ALLOWED_TABLES = ["osm_pois", "census_block_groups"] as const;

export const MAX_RESULT_ROWS = 200;

// Scanned across the WHOLE string, not just the first token — a `WITH`
// CTE can be followed by any of these in raw Postgres (e.g.
// `WITH d AS (DELETE FROM osm_pois RETURNING *) SELECT * FROM d`), so
// anchoring only the first clause wouldn't catch it. The geoquery_ro role
// would still reject the write at the DB layer even if this list had a
// gap — this is belt-and-suspenders, not the only line of defense.
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "CREATE",
  "COPY",
  "VACUUM",
  "CALL",
  "MERGE",
  "EXECUTE",
  "DO",
  "SET",
  "LISTEN",
  "NOTIFY",
  "REFRESH",
  "LOCK",
  "INTO",
  "RETURNING",
];

export interface SqlValidationResult {
  ok: boolean;
  /** Normalized SQL (trailing `;` stripped, LIMIT appended if missing). Only set when ok. */
  sql?: string;
  error?: string;
}

/**
 * Heuristically extracts CTE names from a leading `WITH ... AS (...)`
 * clause, so table-reference checking doesn't reject a CTE alias as if it
 * were an unknown real table. Only handles the common single-level case an
 * LLM is likely to generate (`WITH name AS (...), name2 AS (...) SELECT ...`)
 * — same "documented limitation, not a parser" caveat as the rest of this file.
 */
function extractCteNames(sql: string): string[] {
  if (!/^WITH\b/i.test(sql)) {
    return [];
  }
  const names: string[] = [];
  const cteDefPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = cteDefPattern.exec(sql)) !== null) {
    names.push(match[1]!.toLowerCase());
  }
  return names;
}

export function validateReadOnlySql(rawSql: string): SqlValidationResult {
  const trimmed = rawSql.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "sql must not be empty" };
  }

  // Reject SQL comments outright — a classic vector for hiding a second
  // statement or obfuscating a forbidden keyword from naive scanning.
  if (trimmed.includes("--") || trimmed.includes("/*")) {
    return { ok: false, error: "SQL comments are not allowed" };
  }

  // Strip one optional trailing semicolon, then reject any remaining ';' —
  // blocks stacked-query injection (e.g. "SELECT 1; DROP TABLE osm_pois").
  const withoutTrailingSemicolon = trimmed.endsWith(";")
    ? trimmed.slice(0, -1).trim()
    : trimmed;
  if (withoutTrailingSemicolon.includes(";")) {
    return { ok: false, error: "only a single statement is allowed" };
  }
  const sql = withoutTrailingSemicolon;

  // Allow a leading CTE (WITH ...) in addition to a bare SELECT — the
  // keyword blacklist below is what actually guards against a
  // data-modifying CTE, not this anchor.
  if (!/^(WITH|SELECT)\b/i.test(sql)) {
    return { ok: false, error: "only SELECT statements (optionally with a leading WITH) are allowed" };
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(sql)) {
      return { ok: false, error: `forbidden keyword: ${keyword}` };
    }
  }

  const allowedTables = new Set<string>([...ALLOWED_TABLES, ...extractCteNames(sql)]);
  const tableRefPattern = /\b(?:FROM|JOIN)\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRefPattern.exec(sql)) !== null) {
    const table = tableMatch[1]!.toLowerCase();
    if (!allowedTables.has(table)) {
      return { ok: false, error: `table not allowed: ${table}` };
    }
  }

  // Force a LIMIT if the query doesn't already have one — never trust the
  // caller to have added one. (An existing LIMIT is left as-is; the
  // handler also truncates the JS-side result array to MAX_RESULT_ROWS as
  // a second guard regardless of what the SQL says.)
  const hasLimit = /\bLIMIT\s+\d+/i.test(sql);
  const finalSql = hasLimit ? sql : `${sql} LIMIT ${MAX_RESULT_ROWS}`;

  return { ok: true, sql: finalSql };
}
