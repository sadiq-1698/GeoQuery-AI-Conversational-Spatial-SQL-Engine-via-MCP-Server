import type { z } from "zod";

import type { Database } from "../db.js";
import { MAX_RESULT_ROWS, validateReadOnlySql } from "../sql/allowlist.js";
import type { postgisRawSqlInputSchema } from "../schemas/toolSchemas.js";

// See spatialBuffer.ts for why this uses z.ZodObject<Shape> rather than a
// per-key mapped type (the latter makes optional `params` required instead).
type PostgisRawSqlInput = z.infer<z.ZodObject<typeof postgisRawSqlInputSchema>>;

// Client-side backstop on top of the DB role's own 5s statement_timeout
// (db/schema/004_roles.sh) — catches a hung connection/driver-level stall
// that the DB-side timeout wouldn't, so a bad query can't hang the server.
const QUERY_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Query timed out after ${ms}ms (client-side guard)`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function createPostgisRawSqlHandler(db: Database) {
  return async (input: PostgisRawSqlInput) => {
    const validation = validateReadOnlySql(input.sql);
    if (!validation.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Rejected: ${validation.error}`,
          },
        ],
        isError: true,
      };
    }

    // validation.sql is set whenever validation.ok is true.
    const result = await withTimeout(
      db.query(validation.sql!, input.params ?? []),
      QUERY_TIMEOUT_MS,
    );

    // Second guard beneath the SQL-level LIMIT: bounds the response even if
    // the query text somehow specified a larger limit than we intended.
    const rows = result.rows.slice(0, MAX_RESULT_ROWS);
    const truncated = result.rows.length > rows.length;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ rows, row_count: rows.length, truncated }),
        },
      ],
    };
  };
}
