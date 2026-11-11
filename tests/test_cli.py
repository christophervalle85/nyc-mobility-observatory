import importlib.util
import json
from pathlib import Path

from nyc_mobility.cli import main


def test_fixture_archive_and_default_both_mode(tmp_path, capsys):
    assert importlib.util.find_spec("nyc_mobility.fixtures"), (
        "synthetic fixture archiver is required"
    )
    root = tmp_path / "fixture"
    assert main(["fixture", "--data-dir", str(root), "--fixture-dir", "tests/fixtures"]) == 0
    snapshot = Path(capsys.readouterr().out.strip())
    assert snapshot.is_file()
    assert (
        main(
            [
                "ingest",
                "--month",
                "2026-09",
                "--offline",
                "--data-dir",
                str(root),
                "--snapshot",
                str(snapshot),
            ]
        )
        == 0
    )
    manifest = Path(capsys.readouterr().out.strip())
    assert json.loads(manifest.read_text())["source_kind"] == "synthetic_fixture"
    quality = json.loads((manifest.parent / "quality.json").read_text())
    assert quality["subway"]["observed_station_hours"] == 2
    assert quality["taxi"]["eligible_rows"] == 4
    assert main(["ingest", "--month", "2026-13", "--data-dir", str(root)]) == 1
    assert "month" in capsys.readouterr().err
