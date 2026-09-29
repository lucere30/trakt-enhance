from pathlib import Path
import re

p = Path("upstream/trakt_simplified_chinese/src/shared/trakt-translation-helper.mjs")
s = p.read_text(encoding="utf-8")

# Older customization layers could inject the same scope helpers more than once.
# Remove all copies here; the canonical scope patch adds exactly one later.
pattern = re.compile(
    r"\nfunction isChineseProductionRef\(ref\) \{.*?\n\}\n\nfunction shouldTranslateMediaRef\(ref\) \{.*?\n\}\n",
    re.DOTALL,
)
s, _ = pattern.subn("\n", s)
p.write_text(s, encoding="utf-8")
print("Normalized translation scope helper definitions.")
