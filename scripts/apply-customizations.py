"""Layer 1: public controls and request/player switches.
Translation scope/cache behaviour lives in install-translation-policy.py so the
two concerns can evolve independently."""
import json
import re

from _common import fail, insert_before, read, sub_once, write


def js(value):
    return "true" if value is True else "false" if value is False else json.dumps(value, ensure_ascii=False)


def manifest_entry(key, default, type_, tag, desc, options=None, values=None):
    lines = ["    {", f'        key: "{key}",', f"        defaultValue: {js(default)},", f'        type: "{type_}",']
    if options:
        lines += [f"        options: {js(options)},", f"        optionValues: {js(values)},"]
    lines += [f"        tag: {js(tag)},", f"        desc: {js(desc)},", "    },", ""]
    return "\n".join(lines)


def add_manifest_entry(text, before_key, entry_key, block):
    """Insert a whole `{ key: ... }` object before the object owning `before_key`.
    The anchor is the object's opening brace, not its `key:` line."""
    if f'key: "{entry_key}"' in text:
        return text
    anchor = rf'^[ \t]*\{{\n[ \t]*key: "{re.escape(before_key)}",'
    return insert_before(text, anchor, block, f"manifest entry {entry_key} (before {before_key})")


# --- module-manifest.mjs -------------------------------------------------------
manifest = read("module-manifest.mjs")
manifest = add_manifest_entry(manifest, "translationEngine", "historyRequestEnhancementEnabled", manifest_entry(
    "historyRequestEnhancementEnabled", True, "boolean", "历史请求增强",
    "提高历史剧集请求的 limit 以减少分页；关闭后不改变历史记录合并功能"))
manifest = add_manifest_entry(manifest, "characterTranslationEnabled", "translationScope", manifest_entry(
    "translationScope", "all", "select", "媒体翻译范围",
    "控制标题、简介等媒体文本翻译范围；中文/华语模式按 Trakt 的 language/country 判断",
    ["全部作品", "仅中文/华语作品", "关闭媒体翻译"], ["all", "chinese_only", "off"]))
# Master switch sits right before the per-player options in the generated UI.
manifest = add_manifest_entry(manifest, "eplayerxButtonOrder", "playerInjectionEnabled", manifest_entry(
    "playerInjectionEnabled", True, "boolean", "播放器注入",
    "播放器注入总开关；关闭后不注入 EplayerX、Forward、Infuse、Rex 等播放器来源"))
write("module-manifest.mjs", manifest)

# --- argument.mjs: normalise the new enum once at parse time -----------------------
argument = read("argument.mjs")
if "function normalizeTranslationScope(" not in argument:
    fn = '''function normalizeTranslationScope(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    const labelMap = {
        全部作品: "all",
        "仅中文/华语作品": "chinese_only",
        关闭媒体翻译: "off",
    };
    if (labelMap[normalized]) {
        return labelMap[normalized];
    }
    return ["all", "chinese_only", "off"].includes(normalized) ? normalized : "all";
}

'''
    argument = insert_before(argument, r"^function normalizeDebugMode\(", fn, "normalizeTranslationScope")
if "translationScope: normalizeTranslationScope(argument.translationScope)" not in argument:
    old = "        translationEngine: normalizeTranslationEngine(argument.translationEngine),\n"
    if old not in argument:
        fail("anchor not found: translationEngine normalisation in argument.mjs")
    argument = argument.replace(old, old + "        translationScope: normalizeTranslationScope(argument.translationScope),\n", 1)
write("argument.mjs", argument)

# --- history request expansion is independent from history grouping ------------------
history = read("features/history-episodes-merged-by-show.mjs")
if "function shouldEnhanceHistoryEpisodesRequest(" not in history:
    guard = '''function shouldEnhanceHistoryEpisodesRequest(url) {
    const context = globalThis.$ctx;
    return context.argument.historyRequestEnhancementEnabled !== false && isTraktUserAgent() && isHistoryEpisodesListUrl(url);
}

'''
    history = insert_before(history, r"^function buildMergedHistoryEpisodesRequestUrl\(", guard, "history request switch")
history = sub_once(
    history,
    r"(async function handleMergedHistoryEpisodesRewriteRequest\(\) \{\n\s*const context = globalThis\.\$ctx;\n)\s*if \(!shouldMergeHistoryEpisodesByShow\(context\.url\)\) \{",
    r"\1    if (!shouldEnhanceHistoryEpisodesRequest(context.url)) {",
    "history request call site",
    "if (!shouldEnhanceHistoryEpisodesRequest(context.url))",
)
write("features/history-episodes-merged-by-show.mjs", history)

# --- master player switch; individual player options stay untouched -------------------
PLAYER_HANDLERS = {
    "features/player-injection-sofatime.mjs": ["handleTmdbProviderCatalog", "handleTmdbDetailWatchProviders"],
    "features/player-injection-trakt.mjs": ["handleWatchnow", "handleWatchnowSources", "handleDirectRedirectRequest", "handleTmdbImageWebpRequest"],
}
GUARD = '    if (globalThis.$ctx.argument?.playerInjectionEnabled === false) {\n        return { type: "passThrough" };\n    }\n'
for path, names in PLAYER_HANDLERS.items():
    text = read(path)
    for name in names:
        header = f"async function {name}() {{\n"
        start = text.find(header)
        if start < 0:
            fail(f"{path}: handler {name} not found")
        body_start = start + len(header)
        if not text.startswith(GUARD, body_start):
            text = text[:body_start] + GUARD + text[body_start:]
    write(path, text)

print("Custom controls applied.")
