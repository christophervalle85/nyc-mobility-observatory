import tomllib
from pathlib import Path


def test_project_has_pinned_local_runtime():
    root = Path(__file__).resolve().parents[1]
    assert (root / "pyproject.toml").exists(), "package configuration is required"
    project = tomllib.loads((root / "pyproject.toml").read_text())
    assert project["project"]["requires-python"] == ">=3.12,<3.13"
    assert project["project"]["dependencies"] == ["duckdb==1.4.3"]
    assert project["project"]["scripts"]["mobility"] == "nyc_mobility.cli:main"
