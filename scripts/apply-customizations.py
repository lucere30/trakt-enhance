from pathlib import Path
import re

ROOT = Path("upstream/trakt_simplified_chinese/src")


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def insert_once(text, marker_pattern, insertion, label):
    if insertion.strip() in text:
        return text
    match = re.search(marker_pattern, text, flags=re.MULTILINE)
    if not match:
        raise SystemExit(f"Stable anchor not found for {label}: {marker_pattern}")
    return text[:match.start()] + insertion + text[match.start():]


def insert_before_key(text, key, block):
    if f'key: "{key}"' in text and block.strip() in text:
        return text
    pattern = rf"(?m)^\s*key: \"{re.escape(key)}\","
    return insert_once(text, pattern, block, f"argument {key}")


# Keep this layer limited to public controls and request/player switches.
# Translation/cache behavior lives in fix-translation-scope-and-cache.py so the
# two concerns can evolve independently and upstream changes are easier to absorb.
manifest = read("module-manifest.mjs")

history_block = '''    {\n        key: "historyRequestEnhancementEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "历史请求增强",\n        desc: "提高历史剧集请求的 limit 以减少分页；关闭后不改变历史记录合并功能",\n    },\n'''
manifest = insert_before_key(manifest, "translationEngine", history_block)

translation_scope_block = '''    {\n        key: "translationScope",\n        defaultValue: "all",\n        type: "select",\n        options: ["全部作品", "仅中文/华语作品", "关闭媒体翻译"],\n        optionValues: ["all", "chinese_only", "off"],\n        tag: "媒体翻译范围",\n        desc: "控制标题、简介等媒体文本翻译范围；中文/华语模式按 Trakt 的 language/country 判断",\n    },\n'''
manifest = insert_before_key(manifest, "characterTranslationEnabled", translation_scope_block)

player_master_block = '''    {\n        key: "playerInjectionEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "播放器注入",\n        desc: "播放器注入总开关；关闭后不注入 EplayerX、Forward、Infuse、Rex 等播放器来源",\n    },\n'''
manifest = insert_before_key(manifest, "forwardButtonOrder", player_master_block)
write("module-manifest.mjs", manifest)

# Normalize the new enum once at argument parsing time.
argument = read("argument.mjs")
if "function normalizeTranslationScope(" not in argument:
    fn = '''function normalizeTranslationScope(value) {\n    const normalized = String(value ?? "").trim().toLowerCase();\n    const labelMap = {\n        全部作品: "all",\n        "仅中文/华语作品": "chinese_only",\n        关闭媒体翻译: "off",\n    };\n    if (labelMap[normalized]) {\n        return labelMap[normalized];\n    }\n    return ["all", "chinese_only", "off"].includes(normalized) ? normalized : "all";\n}\n\n'''
    argument = insert_once(argument, r"(?m)^function normalizeDebugMode\(", fn, "normalizeTranslationScope")

if "translationScope: normalizeTranslationScope(argument.translationScope)" not in argument:
    argument = argument.replace(
        '        translationEngine: normalizeTranslationEngine(argument.translationEngine),\n',
        '        translationEngine: normalizeTranslationEngine(argument.translationEngine),\n        translationScope: normalizeTranslationScope(argument.translationScope),\n',
        1,
    )
write("argument.mjs", argument)

# History request expansion is independent from history grouping.
history = read("features/history-episodes-merged-by-show.mjs")
if "function shouldEnhanceHistoryEpisodesRequest(" not in history:
    guard = '''function shouldEnhanceHistoryEpisodesRequest(url) {\n    const context = globalThis.$ctx;\n    return context.argument.historyRequestEnhancementEnabled !== false && isTraktUserAgent() && isHistoryEpisodesListUrl(url);\n}\n\n'''
    history = insert_once(history, r"(?m)^function buildMergedHistoryEpisodesRequestUrl\(", guard, "history request switch")

history = re.sub(
    r"(?s)(async function handleMergedHistoryEpisodesRewriteRequest\(\) \{\n\s*const context = globalThis\.\$ctx;\n)\s*if \(!shouldMergeHistoryEpisodesByShow\(context\.url\)\) \{",
    r'\1    if (!shouldEnhanceHistoryEpisodesRequest(context.url)) {',
    history,
    count=1,
)
write("features/history-episodes-merged-by-show.mjs", history)

# Master player switch. Keep individual player order/options untouched.
for path, functions in {
    "features/player-injection-sofatime.mjs": ["handleTmdbProviderCatalog", "handleTmdbDetailWatchProviders"],
    "features/player-injection-trakt.mjs": ["handleWatchnow", "handleWatchnowSources", "handleDirectRedirectRequest", "handleTmdbImageWebpRequest"],
}.items():
    text = read(path)
    for name in functions:
        marker = rf"(?m)^(async function {name}\(\) \{{\n)"
        guard = f'    if (globalThis.$ctx.argument?.playerInjectionEnabled === false) {{\n        return {{ type: "passThrough" }};\n    }}\n'
        if guard.strip() not in text[text.find(f"async function {name}"):text.find(f"async function {name}") + 500]:
            text = re.sub(marker, r"\1" + guard, text, count=1)
    write(path, text)

print("Custom controls applied with stable, idempotent anchors.")
