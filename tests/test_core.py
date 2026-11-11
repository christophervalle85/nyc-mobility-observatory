import importlib.util
from pathlib import Path

import duckdb
import pytest


def test_core_exists():
    assert importlib.util.find_spec("nyc_mobility.core"), "core boundary is not implemented"


def test_month_and_database_boundaries(tmp_path):
    from nyc_mobility.core import connect, month_bounds

    assert month_bounds("2026-09") == ("2026-09-01 00:00:00", "2026-10-01 00:00:00")
    assert month_bounds("2026-12")[1] == "2027-01-01 00:00:00"
    for invalid in ("2026-9", "2026-13", "../2026-09", "2026-09\n"):
        with pytest.raises(ValueError):
            month_bounds(invalid)
    with connect() as db:
        assert db.sql("select current_setting('threads')").fetchone()[0] == 2
        assert not db.sql("select current_setting('autoinstall_known_extensions')").fetchone()[0]
        assert not db.sql("select current_setting('autoload_known_extensions')").fetchone()[0]
        with pytest.raises(duckdb.Error):
            db.execute("select * from read_csv(?)", ["https://example.com/a.csv"])
    assert isinstance(tmp_path, Path)
