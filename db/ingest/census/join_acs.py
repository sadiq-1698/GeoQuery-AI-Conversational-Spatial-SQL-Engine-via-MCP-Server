#!/usr/bin/env python3
"""Join ACS demographic columns onto census_block_groups, matched by GEOID.

Run census/load_tiger.sh first — this script only UPDATEs rows that already
exist for --region; it never inserts geometry.

Usage:
    python3 join_acs.py --region seattle-wa --acs-csv seattle_acs.csv --db-url "$DATABASE_URL"

Expects a CSV with a header row containing these columns (rename your
downloaded ACS export's variable codes to these names before running):
    GEOID           12-digit block-group GEOID (join key)
    population      ACS B01003_001E (total population)
    median_income   ACS B19013_001E (median household income)
    housing_units   ACS B25001_001E (total housing units)

Requires: pip install psycopg2-binary
"""
import argparse
import csv
import sys

import psycopg2
from psycopg2.extras import execute_values

REQUIRED_COLUMNS = ("GEOID", "population", "median_income", "housing_units")


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--region", required=True, help="Region label rows were tagged with by load_tiger.sh")
    parser.add_argument("--acs-csv", required=True, help="Path to the ACS demographic CSV")
    parser.add_argument("--db-url", required=True, help="Postgres admin connection string")
    return parser.parse_args()


def _int_or_none(value):
    if value is None or value.strip() == "":
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def load_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            sys.exit(f"error: --acs-csv is missing expected column(s): {missing}")
        return [
            (
                record["GEOID"].strip(),
                _int_or_none(record.get("population")),
                _int_or_none(record.get("median_income")),
                _int_or_none(record.get("housing_units")),
            )
            for record in reader
        ]


def main():
    args = parse_args()
    rows = load_rows(args.acs_csv)
    if not rows:
        sys.exit("error: no rows found in --acs-csv")

    conn = psycopg2.connect(args.db_url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TEMP TABLE acs_staging (
                    geoid TEXT PRIMARY KEY,
                    population INTEGER,
                    median_income INTEGER,
                    housing_units INTEGER
                ) ON COMMIT DROP
                """
            )
            execute_values(
                cur,
                "INSERT INTO acs_staging (geoid, population, median_income, housing_units) VALUES %s",
                rows,
            )
            cur.execute(
                """
                UPDATE census_block_groups cbg
                SET population = a.population,
                    median_income = a.median_income,
                    housing_units = a.housing_units
                FROM acs_staging a
                WHERE cbg.geoid = a.geoid
                  AND cbg.region = %s
                """,
                (args.region,),
            )
            updated = cur.rowcount
    finally:
        conn.close()

    print(f"Updated {updated} of {len(rows)} block group(s) for region '{args.region}'.")
    if updated < len(rows):
        print(
            f"warning: {len(rows) - updated} ACS row(s) had no matching GEOID in "
            f"census_block_groups for region '{args.region}' — run census/load_tiger.sh "
            "first, or check the CSV's GEOID values.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
