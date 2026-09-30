#!/usr/bin/env bash
# Restore EplayerX into ./upstream/trakt_simplified_chinese/src.
# Upstream removed it in REMOVAL_COMMIT. Strategy: check out the pre-removal
# source, replay every later upstream change on top, then take upstream HEAD's
# argument.mjs (so its own later changes are kept) and re-add the two
# EplayerX entries to it.
set -euo pipefail
cd upstream

REMOVAL_COMMIT="0886a1d912cfa78a395e5a37278903be9537c1f6"
SRC="trakt_simplified_chinese/src"
ARG="$SRC/argument.mjs"

parent="$(git rev-parse "${REMOVAL_COMMIT}^")"
head="$(git rev-parse origin/main)"

cp "$ARG" /tmp/head-argument.mjs
git checkout "$parent" -- "$SRC"
git diff --binary "$REMOVAL_COMMIT" "$head" -- "$SRC" ":!$ARG" > /tmp/after-removal.patch
if [ -s /tmp/after-removal.patch ]; then
  git apply --3way /tmp/after-removal.patch
fi

# Re-add EplayerX to HEAD's argument.mjs and use that file (the previous
# workflow edited a temp copy and never wrote it back).
python3 - <<'PY'
from pathlib import Path
head = Path("/tmp/head-argument.mjs").read_text(encoding="utf-8")
if 'eplayerxButtonOrder: "eplayerx"' not in head:
    head = head.replace("const PLAYER_BUTTON_ARGUMENT_GROUP_KEYS = {\n",
                        'const PLAYER_BUTTON_ARGUMENT_GROUP_KEYS = {\n    eplayerxButtonOrder: "eplayerx",\n', 1)
if "eplayerx: 1," not in head:
    head = head.replace("function createDefaultPlayerButtonOrderConfig() {\n    return {\n",
                        "function createDefaultPlayerButtonOrderConfig() {\n    return {\n        eplayerx: 1,\n", 1)
Path("trakt_simplified_chinese/src/argument.mjs").write_text(head, encoding="utf-8")
PY

grep -R -q 'EPLAYERX' "$SRC"
grep -q 'eplayerxButtonOrder: "eplayerx"' "$ARG"
grep -q 'eplayerx: 1,' "$ARG"
echo "EplayerX restored (upstream ${head:0:7})."
