"""Publish the built upstream plugin into ./trakt_simplified_chinese.

- rewrites every upstream repo reference (JS *and* plugin) to this repository
- mirrors all runtime images (player logos are fetched by the JS at runtime)
- keeps existing files when only the build timestamp differs (no noise commits)
- asserts the final artifacts; every check raises, none rely on shell `!`"""
import re
import shutil
from pathlib import Path

from _common import fail

UPSTREAM_REPO = "DemoJameson/Proxy.Modules"
THIS_REPO = "lucere30/trakt-enhance"
BUILT = Path("upstream/trakt_simplified_chinese")
OUT = Path("trakt_simplified_chinese")
NAMES = ("trakt_simplified_chinese.js", "trakt_simplified_chinese.plugin")


def normalize(text):
    """Drop build-time noise: header timestamp and the UA version (YYMMDDHHmm)."""
    text = re.sub(r"^// 生成时间：.*$", "// 生成时间：<build>", text, flags=re.M)
    return re.sub(r'\{return"\d{10}"\}', '{return"<build>"}', text)


def require(cond, message):
    if not cond:
        fail(message)


OUT.mkdir(exist_ok=True)
changed = []

for name in NAMES:
    new = (BUILT / name).read_text(encoding="utf-8").replace(UPSTREAM_REPO, THIS_REPO)
    target = OUT / name
    if target.exists() and normalize(target.read_text(encoding="utf-8")) == normalize(new):
        continue
    target.write_text(new, encoding="utf-8")
    changed.append(name)

(OUT / "images").mkdir(exist_ok=True)
for img in sorted((BUILT / "images").iterdir()):
    dst = OUT / "images" / img.name
    if not dst.exists() or dst.read_bytes() != img.read_bytes():
        shutil.copy2(img, dst)
        changed.append(f"images/{img.name}")

# --- assertions on the published artifacts ------------------------------------------
js = (OUT / NAMES[0]).read_text(encoding="utf-8")
plugin = (OUT / NAMES[1]).read_text(encoding="utf-8")

for label, text in (("js", js), ("plugin", plugin)):
    require(UPSTREAM_REPO not in text, f"{label}: upstream repo reference remains")
require(f"{THIS_REPO}/main/trakt_simplified_chinese/{NAMES[0]}" in plugin, "plugin: script URL does not point to this repo")
require("EplayerX" in plugin, "plugin: EplayerX missing")

# every runtime image the JS can request must exist in this repo
logos = re.findall(r'logo:"([a-z]+_logo\.webp)"', js)
require(len(logos) >= 4, f"js: expected player logos, found {logos}")
for logo in set(logos) | {"trakt.webp"}:
    require((OUT / "images" / logo).is_file(), f"missing mirrored image: {logo}")

# [Argument] declarations and every script's argument list must agree
declared = re.findall(r"^(\w+) = (?:switch|select|input)\b", plugin.split("[Script]")[0], flags=re.M)
lists = {tuple(re.findall(r"\{(\w+)\}", m)) for m in re.findall(r"argument=\[([^\]]*)\]", plugin)}
require(len(lists) == 1, f"plugin: script lines use {len(lists)} different argument lists")
require(set(declared) == set(next(iter(lists))), "plugin: [Argument] keys and script argument list differ")
for key in ("translationScope", "historyRequestEnhancementEnabled", "playerInjectionEnabled", "eplayerxButtonOrder"):
    require(key in declared, f"plugin: control {key} missing")
require(declared.index("playerInjectionEnabled") < declared.index("eplayerxButtonOrder"), "plugin: master player switch must precede per-player options")

print("Published:", ", ".join(changed) if changed else "no changes (timestamp-only differences ignored)")
