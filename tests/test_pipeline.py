import importlib.util
import json

import pytest
from test_taxi import fixture_inputs

from nyc_mobility.acquisition import save_snapshot, store_bytes


def snapshot_fixture(tmp_path, *, bad=False):
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    rows = [("2026-09-01", "2026-09-01 01:00", 999, 2, 1.0, 1.0)] if bad else None
    taxi, lookup = fixture_inputs(inputs, rows)
    root = tmp_path / "data"
    assets = {
        "taxi": store_bytes(taxi.read_bytes(), root, "taxi", ".parquet", "fixture:taxi"),
        "lookup": store_bytes(lookup.read_bytes(), root, "lookup", ".csv", "fixture:lookup"),
    }
    return root, save_snapshot(
        {
            "snapshot_version": 1,
            "month": "2026-09",
            "taxi_only": True,
            "source_kind": "fixture",
            "assets": assets,
            "mta": None,
        },
        root,
    )


def test_pipeline_exists():
    assert importlib.util.find_spec("nyc_mobility.pipeline"), "run publication is not implemented"


def test_offline_recomputes_identical_outputs(tmp_path, monkeypatch):
    from nyc_mobility import pipeline

    root, snapshot = snapshot_fixture(tmp_path)
    calls = []
    real = pipeline.validate_taxi

    def tracking(*args, **kwargs):
        calls.append(True)
        return real(*args, **kwargs)

    monkeypatch.setattr(pipeline, "validate_taxi", tracking)

    def network_forbidden(*args, **kwargs):
        pytest.fail("offline replay attempted network access")

    monkeypatch.setattr(pipeline, "acquire", network_forbidden)
    first = pipeline.run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    second = pipeline.run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    assert first == second
    assert len(calls) == 2  # An existing run is verified by actual recomputation.
    report = json.loads(first.read_text())
    assert report["status"] == "completed"
    assert report["inputs"]["taxi"]["sha256"]
    assert set(report["outputs"]) >= {"taxi/zone_hour.csv", "quality.json", "data-dictionary.md"}
    independent = pipeline.run(
        "2026-09",
        root,
        offline=True,
        snapshot=snapshot,
        taxi_only=True,
        output_dir=tmp_path / "independent",
    )
    assert json.loads(independent.read_text())["outputs"] == report["outputs"]


def test_failure_does_not_publish_success(tmp_path):
    from nyc_mobility.pipeline import run

    root, snapshot = snapshot_fixture(tmp_path, bad=True)
    with pytest.raises(ValueError, match="zone"):
        run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    assert not list((root / "runs").glob("*/manifest.json"))
    failure = list((root / "failures").glob("*.json"))
    assert len(failure) == 1
    assert json.loads(failure[0].read_text())["status"] == "failed"


def test_snapshot_checksum_and_mode_mismatch_fail(tmp_path):
    from nyc_mobility.pipeline import run

    root, snapshot = snapshot_fixture(tmp_path)
    with pytest.raises(ValueError, match="mode|taxi"):
        run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=False)
    snapshot.write_text(snapshot.read_text().replace("2026-09", "2026-08"))
    with pytest.raises(ValueError, match="checksum"):
        run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)


def test_monthly_roster_conflicts_are_not_hidden(tmp_path):
    from nyc_mobility.acquisition import derive_roster

    source = tmp_path / "stations.csv"
    source.write_text(
        "station_complex_id,station_complex,borough,latitude,longitude,transit_mode\n"
        "1,A,Manhattan,40.7,-73.9,subway\n1,B,Manhattan,40.7,-73.9,subway\n"
    )
    with pytest.raises(ValueError, match="conflicting"):
        derive_roster(source, tmp_path / "data", "2026-09")


@pytest.mark.parametrize("field", ["status", "input_hash", "snapshot_reference"])
def test_existing_manifest_corruption_is_rejected(tmp_path, field):
    from nyc_mobility.pipeline import run

    root, snapshot = snapshot_fixture(tmp_path)
    path = run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    value = json.loads(path.read_text())
    if field == "status":
        value["status"] = "failed"
    elif field == "input_hash":
        value["inputs"]["taxi"]["sha256"] = "0" * 64
    else:
        value["snapshot"] = "sha256:" + "0" * 64
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="manifest|immutable|corrupt"):
        run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)


def test_changed_code_during_run_is_not_published(tmp_path, monkeypatch):
    from nyc_mobility import pipeline

    root, snapshot = snapshot_fixture(tmp_path)
    fingerprints = iter(["before", "after"])
    monkeypatch.setattr(pipeline, "code_hash", lambda: next(fingerprints))
    with pytest.raises(ValueError, match="source|code"):
        pipeline.run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    assert not list((root / "runs").glob("*/manifest.json"))


@pytest.mark.parametrize("directory", ["runs", "failures"])
def test_run_rejects_descendant_output_and_failure_symlinks(tmp_path, directory):
    from nyc_mobility.pipeline import run

    root, snapshot = snapshot_fixture(tmp_path, bad=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / directory).symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink|symbolic"):
        run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    assert not list(outside.iterdir())


def test_relocated_archive_and_completed_run_can_be_replayed(tmp_path):
    import shutil

    from nyc_mobility.pipeline import run

    root, snapshot = snapshot_fixture(tmp_path)
    original_manifest = run("2026-09", root, offline=True, snapshot=snapshot, taxi_only=True)
    original = json.loads(original_manifest.read_text())
    relocated = tmp_path / "relocated archive"
    shutil.move(str(root), relocated)
    replay = run("2026-09", relocated, offline=True, taxi_only=True)
    assert replay == relocated / "runs" / original["run_id"] / "manifest.json"
    result = json.loads(replay.read_text())
    assert result["outputs"] == original["outputs"]
    assert result["snapshot"] == "sha256:" + original["identity"]["snapshot_sha256"]
    assert not root.exists()
