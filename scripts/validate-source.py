"""Fail-fast checks on the patched upstream source, run before the build.
Replaces the grep blocks that used to live in the workflow (a `! grep` in the
middle of a `set -e` script never fails, so those checks were ineffective)."""
import json
import re
import subprocess
import sys

from _common import SRC, fail, read

manifest = read("module-manifest.mjs")
helper = read("shared/trakt-translation-helper.mjs")
policy = read("shared/translation-scope-policy.mjs")
history = read("features/history-episodes-merged-by-show.mjs")
argument = read("argument.mjs")


def require(cond, message):
    if not cond:
        fail(message)


# 1. manifest: every public control exists exactly once; EplayerX is present.
KEYS = ["historyRequestEnhancementEnabled", "translationScope", "playerInjectionEnabled", "eplayerxButtonOrder"]
for key in KEYS:
    n = len(re.findall(rf'key: "{key}"', manifest))
    require(n == 1, f"manifest: expected one entry for {key}, found {n}")
require('eplayerxButtonOrder: "eplayerx"' in argument and "eplayerx: 1," in argument, "argument.mjs: EplayerX entries missing")
require("EPLAYERX" in "".join(p.read_text(encoding="utf-8") for p in SRC.rglob("*.mjs")), "EplayerX source missing")

# 2. translation policy: single owner, wired into the helper, scope-gated at every boundary.
for legacy in ("isChineseProductionRef", "shouldTranslateMediaRef"):
    require(not re.search(rf"\bfunction\s+{legacy}\s*\(", helper), f"legacy helper declaration remains: {legacy}")
for name in ("isChineseProduction", "shouldTranslateMedia"):
    n = len(re.findall(rf"\bexport\s+function\s+{name}\s*\(", policy))
    require(n == 1, f"policy: expected one {name}, found {n}")
require(helper.count('import { shouldTranslateMedia } from "./translation-scope-policy.mjs";') == 1, "helper: policy import must appear exactly once")
for marker, what in (
    ("const translationRefsByType =", "scope boundary"),
    ("hydrateFromBackend(cache, translationRefsByType", "backend hydration gate"),
    ("fetchBulkTranslationsForMissing(cache, translationRefsByType", "bulk translation gate"),
    ("getMissingRefs(cache, mediaType, translationRefsByType[mediaType])", "direct translation gate"),
    ("if (shouldTranslateMedia(ref)) applyTranslationFn", "cached application gate"),
    ("language: item?.show?.language ?? null", "episode refs inherit show language"),
):
    require(marker in helper, f"helper: {what} missing")

# 3. call sites of the request/player switches (definitions alone are not enough).
require("if (!shouldEnhanceHistoryEpisodesRequest(context.url))" in history, "history request switch not wired into the request handler")
for path, count in (("features/player-injection-sofatime.mjs", 2), ("features/player-injection-trakt.mjs", 4)):
    n = read(path).count("playerInjectionEnabled === false")
    require(n == count, f"{path}: expected {count} playerInjection guards, found {n}")

# 4. behaviour test of the policy (loaded as a real ES module).
CASES = [
    # (ref, scope, expected)
    ({"language": "en", "country": "us"}, "all", True),
    ({"language": "en", "country": "us"}, "chinese_only", False),
    ({"language": "zh", "country": "us"}, "chinese_only", True),
    ({"language": "en", "country": "sg"}, "chinese_only", True),
    ({"language": "ko", "country": "kr"}, "chinese_only", False),
    ({"language": "en", "country": None}, "chinese_only", False),
    ({"language": "zh", "country": "cn"}, "off", False),
]
script = f"""
import {{ shouldTranslateMedia }} from {json.dumps("file://" + str((SRC / "shared/translation-scope-policy.mjs").resolve()))};
const out = {json.dumps(CASES)}.map(([ref, scope]) => shouldTranslateMedia(ref, {{ translationScope: scope, translationEngine: "off" }}));
console.log(JSON.stringify(out));
"""
res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True)
require(res.returncode == 0, f"policy self-test crashed: {res.stderr.strip()}")
got = json.loads(res.stdout)
for (ref, scope, expected), actual in zip(CASES, got):
    require(actual == expected, f"policy self-test: {ref} scope={scope} expected {expected}, got {actual}")

# 5. every patched module must parse.
for rel in ("module-manifest.mjs", "argument.mjs", "shared/trakt-translation-helper.mjs", "shared/translation-scope-policy.mjs",
            "features/history-episodes-merged-by-show.mjs", "features/player-injection-sofatime.mjs", "features/player-injection-trakt.mjs"):
    r = subprocess.run(["node", "--check", str(SRC / rel)], capture_output=True, text=True)
    require(r.returncode == 0, f"syntax error in {rel}:\n{r.stderr.strip()}")

print("Source validation passed.")
