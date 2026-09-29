import { config } from "dotenv";
import path from "node:path";
import type { NextConfig } from "next";

// Next.js's built-in env loading only reads .env* files from this project's
// own root (apps/web) — it has no concept of a parent directory. This repo
// has kept a single .env at the monorepo root since Session 1 (it's what
// docker-compose and db/migrate.sh both read too), so load that explicitly
// here rather than asking for a second, duplicated .env inside apps/web.
// Loading it into process.env before Next's own .env lookup runs is enough:
// process.env is checked first in Next's load order, so this doesn't
// conflict with anything — see apps/web/README.md for the full explanation.
// No-ops harmlessly if the file doesn't exist (e.g. in CI/typecheck).
config({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
