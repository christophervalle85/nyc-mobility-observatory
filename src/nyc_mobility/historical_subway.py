"""Historical MTA validation with pinned display points and intact source observations."""

import hashlib
import math
from pathlib import Path

import duckdb

from .subway import _load_csv, _local_file, _month_grid, _validate_subway

_REFERENCE_FIELDS = ("complex_id", "display_name", "borough", "latitude", "longitude")
_BOROUGHS = {
    "M": "Manhattan",
    "Bk": "Brooklyn",
    "Bx": "Bronx",
    "Q": "Queens",
    "SI": "Staten Island",
}
MAX_REFERENCE_DISTANCE_METRES = 300
MAX_CLUSTER_SPREAD_METRES = 500

# Explicit ID/name pairs observed in all three audited historical pilots and the pinned
# official registry. Unknown names or a changed registry label require a separate review.
_REVIEWED_NAMES: dict[int, tuple[str, str]] = {
    91: ("Alabama Av (J)", "Alabama Av (J,Z)"),
    221: ("21 St-Queensbridge (F)", "21 St-Queensbridge (M)"),
    222: ("Roosevelt Island (F)", "Roosevelt Island (M)"),
    223: ("Lexington Av/63 St (F,Q)", "Lexington Av/63 St (M,Q)"),
    224: ("57 St (F)", "57 St (M)"),
    273: ("Queens Plaza (E,M,R)", "Queens Plaza (E,F,R)"),
    276: ("5 Av/53 St (E,M)", "5 Av/53 St (E,F)"),
    323: ("Christopher St-Sheridan Sq (1)", "Christopher St-Stonewall (1)"),
    405: ("23 St (6)", "23 St-Baruch College (6)"),
    441: ("Central Park North (110 St) (2,3)", "110 St-Malcolm X Plaza (2,3)"),
    601: ("14 St (F,M,1,2,3)/6 Av (L)", "14 St/6 Av (1,2,3,L,F,M)"),
    602: ("14 St-Union Sq (L,N,Q,R,W,4,5,6)", "14 St-Union Sq (4,5,6,L,N,Q,R,W)"),
    603: ("149 St-Grand Concourse (2,4,5)", "149 St-Hostos (2,4,5)"),
    604: ("161 St-Yankee Stadium (B,D,4)", "161 St-Yankee Stadium (4,B,D)"),
    605: ("168 St (A,C,1)", "168 St-Washington Hts (1,A,C)"),
    606: ("Court Sq (E,G,M,7)", "Court Sq-23 St (7,E,F,G)"),
    608: ("4 Av (F,G)/9 St (R)", "4 Av-9 St (F,G,R)"),
    609: ("Bryant Pk (B,D,F,M)/5 Av (7)", "42 St-Bryant Pk/5 Av (7,B,D,F,M)"),
    610: ("Grand Central-42 St (S,4,5,6,7)", "Grand Central-42 St (4,5,6,7,S)"),
    611: (
        "Times Sq-42 St (N,Q,R,W,S,1,2,3,7)/42 St (A,C,E)",
        "Times Sq-42 St/Port Authority Bus Terminal (1,2,3,7,A,C,E,N,Q,R,W,S)",
    ),
    612: ("Lexington Av-53 St (E,M)/51 St (6)", "Lexington Av/51-53 Sts (6,E,F)"),
    613: ("Lexington Av (N,R,W)/59 St (4,5,6)", "Lexington Av/59 St (4,5,6,N,R,W)"),
    614: ("59 St-Columbus Circle (A,B,C,D,1)", "59 St-Columbus Circle (1,A,C,B,D)"),
    615: ("New Utrecht Av (N)/62 St (D)", "62 St/New Utrecht Av (D,N)"),
    616: (
        "74-Broadway (7)/Jackson Hts-Roosevelt Av (E,F,M,R)",
        "Jackson Hts-Roosevelt Av/74 St-Broadway (7,E,F,M,R)",
    ),
    617: (
        "Atlantic Av-Barclays Ctr (B,D,N,Q,R,2,3,4,5)",
        "Atlantic Av-Barclays Ctr (2,3,4,5,B,D,N,Q,R)",
    ),
    618: ("14 St (A,C,E)/8 Av (L)", "14 St/8 Av (A,C,E,L)"),
    619: (
        "Broadway-Lafayette St (B,D,F,M)/Bleecker St (6)",
        "Broadway-Lafayette St/Bleecker St (6,B,D,F,M)",
    ),
    620: ("Court St (R)/Borough Hall (2,3,4,5)", "Borough Hall/Court St (2,3,4,5,R)"),
    621: ("Broadway Junction (A,C,J,L,Z)", "Broadway Junction (A,C,J,Z,L)"),
    622: (
        "Brooklyn Bridge-City Hall (4,5,6)/Chambers St (J,Z)",
        "Brooklyn Bridge-City Hall/Chambers St (4,5,6,J,Z)",
    ),
    623: ("Canal St (J,N,Q,R,W,Z,6)", "Canal St (6,J,Z,N,Q,R,W)"),
    624: (
        "Chambers St (A,C)/WTC (E)/Park Pl (2,3)/Cortlandt (R,W)",
        "Chambers St/WTC/Park Place/Cortlandt St (2,3,A,C,E,R,W)",
    ),
    625: ("Delancey St (F)/Essex St (J,M,Z)", "Delancey St-Essex St (F,M,J,Z)"),
    626: (
        "Franklin Av (2,3,4,5)/Botanic Garden (S)",
        "Franklin Av-Medgar Evers College/Botanic Garden (2,3,4,5,S)",
    ),
    628: ("Fulton St (A,C,J,Z,2,3,4,5)", "Fulton St (2,3,4,5,A,C,J,Z)"),
    629: ("Lorimer St (L)/Metropolitan Av (G)", "Metropolitan Av/Lorimer St (G,L)"),
    630: ("Myrtle-Wyckoff Avs (L,M)", "Myrtle-Wyckoff Avs (M,L)"),
    635: ("South Ferry (1)/Whitehall St (R,W)", "Whitehall St-South Ferry (1,R,W)"),
}


def _distance(first: tuple[float, float], second: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*first, *second))
    chord = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 12_742_000 * math.asin(min(1, math.sqrt(chord)))


def _historical_month(month: str) -> None:
    _, _, grid = _month_grid(month)
    if not "2020-01" <= month <= "2024-12":
        raise ValueError("Historical subway validation only supports 2020–2024")
    if any(transition for _, _, transition in grid):
        raise ValueError("Historical subway export does not support DST-transition months")


def _historical_reference(
    connection: duckdb.DuckDBPyConnection, reference_path: Path, month: str
) -> dict:
    _historical_month(month)
    reference_path = _local_file(reference_path, "pinned MTA complex reference")
    _load_csv(connection, reference_path, _REFERENCE_FIELDS, "display_reference_raw")
    registry = {}
    for station_id, name, borough, latitude, longitude in connection.execute(
        "SELECT complex_id,display_name,borough,latitude,longitude FROM display_reference_raw"
    ).fetchall():
        if (
            not station_id
            or not station_id.isascii()
            or not station_id.isdigit()
            or int(station_id) <= 0
        ):
            raise ValueError("Pinned reference has an invalid complex ID")
        sid = int(station_id)
        if sid in registry:
            raise ValueError("Pinned reference has duplicate complex IDs")
        if not name or not name.strip() or borough not in _BOROUGHS:
            raise ValueError("Pinned reference has an invalid name or borough")
        try:
            point = (float(latitude), float(longitude))
        except (TypeError, ValueError) as exc:
            raise ValueError("Pinned reference has invalid coordinates") from exc
        if not all(math.isfinite(value) for value in point) or not (
            40 <= point[0] <= 42 and -75 <= point[1] <= -72
        ):
            raise ValueError("Pinned reference display point is not plausible for New York City")
        registry[sid] = (name, _BOROUGHS[borough], point)
    if not registry:
        raise ValueError("Pinned reference is empty")
    if connection.execute(
        "SELECT station_id FROM typed WHERE transit_mode='subway' AND station_id<>501 "
        "GROUP BY station_id HAVING count(DISTINCT (latitude_value,longitude_value))>64 LIMIT 1"
    ).fetchone():
        raise ValueError("Historical coordinate cluster has too many variants for bounded review")
    groups: dict[int, list[tuple]] = {}
    for row in connection.execute(
        "SELECT station_id,station_complex,borough,latitude_value,longitude_value,count(*) "
        "FROM typed WHERE transit_mode='subway' AND station_id<>501 GROUP BY ALL "
        "ORDER BY station_id,station_complex,borough,latitude_value,longitude_value"
    ).fetchall():
        groups.setdefault(row[0], []).append(row[1:])
    if not groups:
        raise ValueError("Historical source has no ordinary subway observations")
    display_rows, report = [], []
    for sid, rows in groups.items():
        identities = {(row[0], row[1]) for row in rows}
        if len(identities) != 1:
            raise ValueError(f"Historical complex {sid} has inconsistent name or borough")
        name, borough = next(iter(identities))
        if sid not in registry:
            raise ValueError(f"Historical complex {sid} has no reviewed reference display point")
        reference_name, reference_borough, point = registry[sid]
        if borough != reference_borough:
            raise ValueError(f"Historical complex {sid} borough disagrees with reference")
        if name != reference_name and _REVIEWED_NAMES.get(sid) != (name, reference_name):
            raise ValueError(
                f"Historical complex {sid} has an unreviewed reference name alias: "
                f"{name!r} -> {reference_name!r}"
            )
        pairs = [(row[2], row[3]) for row in rows]
        distance = max(_distance(pair, point) for pair in pairs)
        spread = max(_distance(first, second) for first in pairs for second in pairs)
        if distance > MAX_REFERENCE_DISTANCE_METRES or spread > MAX_CLUSTER_SPREAD_METRES:
            raise ValueError(
                f"Historical complex {sid} coordinate cluster requires review: "
                f"reference distance {distance:.3f}m, spread {spread:.3f}m"
            )
        display_rows.append((sid, name, borough, *point))
        report.append(
            {
                "station_complex_id": sid,
                "station_complex": name,
                "borough": borough,
                "reference_name": reference_name,
                "reviewed_name_alias": name != reference_name,
                "display_latitude": point[0],
                "display_longitude": point[1],
                "source_coordinate_pairs": [
                    {"latitude": row[2], "longitude": row[3], "rows": row[4]} for row in rows
                ],
                "maximum_reference_distance_metres": round(distance, 6),
                "maximum_source_spread_metres": round(spread, 6),
            }
        )
    connection.execute(
        "CREATE TABLE reference(station_id BIGINT,station_complex VARCHAR,"
        "borough VARCHAR,latitude_value DOUBLE,longitude_value DOUBLE)"
    )
    connection.executemany("INSERT INTO reference VALUES (?,?,?,?,?)", display_rows)
    return {
        "policy": "stable complex ID and reviewed identity; pinned reference display points only",
        "reference_dataset": "5f5g-n3cz",
        "reference_sha256": hashlib.sha256(reference_path.read_bytes()).hexdigest(),
        "maximum_allowed_reference_distance_metres": MAX_REFERENCE_DISTANCE_METRES,
        "maximum_allowed_source_spread_metres": MAX_CLUSTER_SPREAD_METRES,
        "fallbacks": [],
        "complexes": report,
    }


def validate_historical_subway(
    input_path: Path, output_dir: Path, month: str, reference_path: Path
) -> dict:
    """Validate original rows unchanged; publish only into caller-owned staging.

    Caller verifies the archived source version and reference hash before invocation.
    Missing IDs, unknown aliases and outlying coordinates fail rather than inventing a point.
    """
    _historical_month(month)
    return _validate_subway(input_path, output_dir, month, historical_reference_path=reference_path)
