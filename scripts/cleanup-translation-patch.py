from pathlib import Path
import re

p = Path("upstream/trakt_simplified_chinese/src/shared/trakt-translation-helper.mjs")
s = p.read_text(encoding="utf-8")

# Remove every previous copy of the two helper declarations. Stop at the next
# top-level function declaration so nested braces inside the functions are safe.
s = re.sub(r"(?ms)^function isChineseProductionRef\(ref\) \{.*?(?=^function |\Z)", "", s)
s = re.sub(r"(?ms)^function shouldTranslateMediaRef\(ref\) \{.*?(?=^function |\Z)", "", s)
p.write_text(s, encoding="utf-8")
print("Normalized translation scope helper definitions.")
