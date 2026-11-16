#!/usr/bin/env bash
# Commit and push only the additions described by a successful mobility apply.
set -euo pipefail

if [[ $# -ne 3 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Usage: %s BASE_SHA APPLY_REPORT REMOTE\n' "$0" >&2
  exit 2
fi

base=$1
report=$2
remote=$3
main_ref=refs/heads/main
canonical_remote=https://github.com/christophervalle85/nyc-mobility-observatory.git
git_remote=(git)

if [[ -n ${GH_TOKEN:-} ]]; then
  if [[ $remote != "$canonical_remote" ]]; then
    printf 'The workflow credential is restricted to the canonical repository.\n' >&2
    exit 1
  fi
  git_remote+=(-c credential.helper= -c 'credential.helper=!gh auth git-credential')
fi
export GIT_TERMINAL_PROMPT=0

if [[ $(git rev-parse HEAD) != "$base" ]]; then
  printf 'The checkout has moved since refresh preparation.\n' >&2
  exit 1
fi

# The report is data. Resolve paths from fixed names and verify all pending changes.
allowed=$(python3 - "$report" "$base" <<'PY'
import json
import re
import subprocess
import sys
from pathlib import Path

catalog = "mobility-months.json"
report = json.loads(Path(sys.argv[1]).read_bytes())
paths, files = report.get("paths"), report.get("files")
if report.get("status") != "applied" or report.get("baseSha") != sys.argv[2]:
    raise SystemExit("Expected a successful apply for the current baseline")
if (
    not isinstance(paths, list)
    or not 2 <= len(paths) <= 3
    or not all(isinstance(name, str) for name in paths)
    or len(set(paths)) != len(paths)
    or catalog not in paths
    or not isinstance(files, dict)
    or set(files) != set(paths)
):
    raise SystemExit("Expected the catalog and one or two mobility assets")
assets = [name for name in paths if name != catalog]
pattern = r"(yellow-taxi|subway)-([0-9]{4}-(?:0[1-9]|1[0-2]))\.json"
matches = [re.fullmatch(pattern, name) for name in assets]
if any(match is None for match in matches) or len({match[2] for match in matches}) != 1:
    raise SystemExit("Expected one calendar month of new mobility assets")

expected = {
    f"web/public/data/{name}": " M" if name == catalog else "??"
    for name in paths
}
pending = subprocess.check_output(
    ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"]
).split(b"\0")
expected_status = {f"{status} {path}".encode() for path, status in expected.items()}
if set(pending[:-1]) != expected_status:
    raise SystemExit("Pending Git changes do not match the release's allowed files")
for path in sorted(expected):
    target = Path(path)
    if target.is_symlink() or not target.is_file():
        raise SystemExit("Expected regular release files")
    print(path)
PY
)

remote_head=$("${git_remote[@]}" ls-remote --exit-code -- "$remote" "$main_ref")
if [[ $remote_head != "$base"$'\t'"$main_ref" ]]; then
  printf 'Remote main changed during refresh. Prepare against the new tip.\n' >&2
  exit 1
fi

paths=()
while IFS= read -r path; do
  paths+=("$path")
done <<< "$allowed"

git add -- "${paths[@]}"
if [[ $(git diff --cached --name-only | LC_ALL=C sort) != "$allowed" ]]; then
  printf 'Staged release paths do not match the validated scope.\n' >&2
  exit 1
fi
python3 - "$report" "${paths[@]}" <<'PY'
import hashlib
import json
import subprocess
import sys
from pathlib import Path

files = json.loads(Path(sys.argv[1]).read_bytes())["files"]
for path in sys.argv[2:]:
    data = subprocess.check_output(["git", "show", ":" + path])
    if files[Path(path).name] != {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}:
        raise SystemExit(f"Staged bytes differ from validated release: {path}")
PY
git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  -c core.hooksPath=/dev/null commit -m 'Publish validated mobility data'
"${git_remote[@]}" push -- "$remote" "HEAD:$main_ref"
