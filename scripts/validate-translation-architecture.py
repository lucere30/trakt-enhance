from pathlib import Path
import re

ROOT = Path("upstream/trakt_simplified_chinese/src")
policy = ROOT / "shared/translation-scope-policy.mjs"
helper = ROOT / "shared/trakt-translation-helper.mjs"

if not policy.exists():
    raise SystemExit("translation-scope-policy.mjs is missing")

policy_text = policy.read_text(encoding="utf-8")
helper_text = helper.read_text(encoding="utf-8")

for legacy in ("isChineseProductionRef", "shouldTranslateMediaRef"):
    if re.search(rf"\bfunction\s+{legacy}\s*\(", helper_text):
        raise SystemExit(f"Legacy helper declaration remains: {legacy}")

for name in ("isChineseProduction", "shouldTranslateMedia"):
    count = len(re.findall(rf"\b(?:export\s+)?function\s+{name}\s*\(", policy_text))
    if count != 1:
        raise SystemExit(f"Expected one policy function {name}, found {count}")

if 'import { shouldTranslateMedia } from "./translation-scope-policy.mjs";' not in helper_text:
    raise SystemExit("Translation policy is not imported by the translation helper")

if "const translationRefsByType =" not in helper_text:
    raise SystemExit("Translation scope boundary is missing")

if "hydrateFromBackend(cache, translationRefsByType" not in helper_text:
    raise SystemExit("Backend hydration is not scope-gated")

if "fetchBulkTranslationsForMissing(cache, translationRefsByType" not in helper_text:
    raise SystemExit("Bulk translation requests are not scope-gated")

if "getMissingRefs(cache, mediaType, translationRefsByType[mediaType])" not in helper_text:
    raise SystemExit("Direct translation requests are not scope-gated")

if "if (shouldTranslateMedia(ref)) applyTranslationFn" not in helper_text:
    raise SystemExit("Cached translation application is not scope-gated")

print("Translation architecture validation passed.")
