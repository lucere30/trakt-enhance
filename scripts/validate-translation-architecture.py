from pathlib import Path
import re

ROOT = Path("upstream/trakt_simplified_chinese/src")

# The translation policy must live in its own module. The upstream helper must
# not contain generated policy declarations; this prevents duplicate-binding
# failures when upstream changes its implementation.
policy = ROOT / "shared/translation-scope-policy.mjs"
helper = ROOT / "shared/trakt-translation-helper.mjs"

if not policy.exists():
    raise SystemExit("translation-scope-policy.mjs is missing")

policy_text = policy.read_text(encoding="utf-8")
helper_text = helper.read_text(encoding="utf-8")

for name in ("isChineseProductionRef", "shouldTranslateMediaRef"):
    if re.search(rf"\bfunction\s+{name}\s*\(", helper_text):
        raise SystemExit(f"Legacy helper declaration remains in upstream helper: {name}")

for name in ("isChineseProduction", "shouldTranslateMedia"):
    count = len(re.findall(rf"\b(?:export\s+)?function\s+{name}\s*\(", policy_text))
    if count != 1:
        raise SystemExit(f"Expected exactly one policy function {name}, found {count}")

if "translation-scope-policy.mjs" not in helper_text:
    raise SystemExit("Upstream helper does not import the isolated translation policy")

print("Translation architecture validation passed.")
