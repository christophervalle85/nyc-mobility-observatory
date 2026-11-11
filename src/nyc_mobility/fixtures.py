"""Archive a tiny synthetic, hand-checkable snapshot without network access."""

import io
import tempfile
import zipfile
from pathlib import Path

from .acquisition import derive_roster, save_snapshot, store_bytes, verify_asset
from .core import connect, safe_directory


def create_fixture_snapshot(data_dir: Path, fixture_dir: Path) -> Path:
    root = data_dir.resolve()
    safe_directory(root, root / "tmp")
    fixture_dir = fixture_dir.resolve()
    assets = {}
    for name, filename in [
        ("taxi_fixture_csv", "taxi.csv"),
        ("lookup", "taxi_zone_lookup.csv"),
        ("subway", "subway.csv"),
    ]:
        assets[name] = store_bytes(
            (fixture_dir / filename).read_bytes(),
            root,
            name,
            ".csv",
            "synthetic-fixture:" + filename,
        )
    with tempfile.TemporaryDirectory(prefix="fixture-", dir=root / "tmp") as temporary:
        parquet = Path(temporary) / "taxi.parquet"
        with connect() as db:
            db.execute(
                """create table synthetic_taxi as select * from read_csv(?, header=true, columns={
                'tpep_pickup_datetime':'TIMESTAMP','tpep_dropoff_datetime':'TIMESTAMP',
                'PULocationID':'INTEGER','DOLocationID':'INTEGER','trip_distance':'DOUBLE',
                'total_amount':'DOUBLE'})""",
                [str(fixture_dir / "taxi.csv")],
            )
            db.execute("copy synthetic_taxi to ? (format parquet)", [str(parquet)])
        assets["taxi"] = store_bytes(
            parquet.read_bytes(), root, "taxi", ".parquet", "synthetic-fixture:taxi.csv-to-parquet"
        )
    assets["roster"] = derive_roster(verify_asset(assets["subway"], root), root, "2026-09")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        # Fixed metadata keeps repeated fixture creation byte-for-byte deterministic.
        info = zipfile.ZipInfo("README.txt", date_time=(2026, 9, 1, 0, 0, 0))
        archive.writestr(info, "Synthetic fixture. No geometry processing in M1.\n")
    assets["polygons"] = store_bytes(
        stream.getvalue(), root, "polygons", ".zip", "synthetic-fixture:zip"
    )
    return save_snapshot(
        {
            "snapshot_version": 1,
            "month": "2026-09",
            "taxi_only": False,
            "source_kind": "synthetic_fixture",
            "assets": assets,
            "mta": {"capture_assurance": "synthetic fixture; not a live source export"},
        },
        root,
    )
