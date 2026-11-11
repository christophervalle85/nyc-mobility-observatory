"""Command-line entry point. No network is reachable in offline execution."""

import argparse
import sys
from pathlib import Path
from urllib.error import URLError

import duckdb

from .pipeline import run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mobility")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("ingest", help="capture and validate both taxi and MTA by default")
    ingest.add_argument("--month", required=True)
    ingest.add_argument("--data-dir", type=Path, default=Path(".data"))
    ingest.add_argument("--output-dir", type=Path)
    ingest.add_argument("--offline", action="store_true", help="verify and recompute frozen inputs")
    ingest.add_argument("--snapshot", type=Path, help="exact archived snapshots/<sha256>.json")
    ingest.add_argument(
        "--taxi-only", action="store_true", help="explicitly omit the MTA companion"
    )
    fixture = commands.add_parser(
        "fixture", help="archive tiny synthetic September inputs, no network"
    )
    fixture.add_argument("--data-dir", type=Path, default=Path(".data-fixture"))
    fixture.add_argument("--fixture-dir", type=Path, default=Path("tests/fixtures"))
    args = parser.parse_args(argv)
    try:
        if args.command == "fixture":
            from .fixtures import create_fixture_snapshot

            result = create_fixture_snapshot(args.data_dir, args.fixture_dir)
        else:
            result = run(
                args.month,
                args.data_dir,
                offline=args.offline,
                snapshot=args.snapshot,
                taxi_only=args.taxi_only,
                output_dir=args.output_dir,
            )
        print(result)
        return 0
    except (ValueError, OSError, URLError, duckdb.Error) as exc:
        print(f"mobility: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
