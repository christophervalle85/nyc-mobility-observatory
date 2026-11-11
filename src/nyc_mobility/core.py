"""Local validation, deterministic encoding and constrained DuckDB connections."""

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

import duckdb

CONTRACT_VERSION = "m1-v1"


def month_bounds(month: str) -> tuple[str, str]:
    if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("month must be YYYY-MM")
    start = datetime.strptime(month, "%Y-%m")
    year, following = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    end = datetime(year, following, 1)
    return start.strftime("%Y-%m-%d %H:%M:%S"), end.strftime("%Y-%m-%d %H:%M:%S")


def connect() -> duckdb.DuckDBPyConnection:
    # Local files remain enabled. Remote filesystems and extension discovery do not.
    db = duckdb.connect(
        config={
            "threads": 2,
            "memory_limit": "4GiB",
            "autoinstall_known_extensions": False,
            "autoload_known_extensions": False,
            "allow_community_extensions": False,
            "allow_unsigned_extensions": False,
        }
    )
    db.execute("SET disabled_filesystems='HTTPFileSystem'")
    return db


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def write_json(path: Path, value: object) -> None:
    path.write_bytes(canonical_bytes(value))


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reject_symlinks(root: Path, path: Path) -> Path:
    """Reject existing descendant links before a local read or write boundary."""
    root, path = root.resolve(), path.absolute()
    if not path.is_relative_to(root):
        raise ValueError("path escapes selected root")
    current = root
    for component in path.relative_to(root).parts:
        current = current / component
        if current.is_symlink():
            raise ValueError(f"symbolic link is not allowed below selected root: {current}")
    return path


def safe_directory(root: Path, path: Path) -> Path:
    path = reject_symlinks(root, path)
    path.mkdir(parents=True, exist_ok=True)
    return path
