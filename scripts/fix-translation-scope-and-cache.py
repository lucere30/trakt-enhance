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


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Stable anchor not found for {label}")
    return text.replace(old, new, 1)


# This is the single owner of translation-scope/cache customization.
# It never modifies the upstream translation helper with generated helper
# declarations. Instead, it adds one small policy module and wires the
# existing translation entry points to that policy. Re-running is safe.
manifest = read("module-manifest.mjs")
start = manifest.find("const argumentFields = [")
end = manifest.find("\nconst ALL_ARGUMENT_KEYS", start)
if start < 0 or end < 0:
    raise SystemExit("argumentFields section not found")

argument_fields = '''const argumentFields = [
    { key: "fakeVipEnabled", defaultValue: true, type: "boolean", tag: "伪装成 VIP", desc: "启用后伪装为 Trakt VIP 会员，移除 App 中的广告" },
    { key: "posterImageMode", defaultValue: "original", type: "select", options: ["原片语言", "中文", "原图"], optionValues: ["original", "chinese", "default"], tag: "海报语言", desc: "选择海报语言或保留原图" },
    { key: "historyEpisodesMergedByShow", defaultValue: true, type: "boolean", tag: "历史剧集按电视剧合并", desc: "将历史页面电视剧观看记录按电视剧合并" },
    { key: "historyRequestEnhancementEnabled", defaultValue: true, type: "boolean", tag: "历史请求增强", desc: "提高历史剧集请求的 limit 以减少分页" },
    { key: "translationEngine", defaultValue: "google", type: "select", options: ["谷歌翻译", "DeepLX", "关闭"], optionValues: ["google", "deeplx", "off"], tag: "翻译部分文本", desc: "选择翻译引擎" },
    { key: "translationScope", defaultValue: "all", type: "select", options: ["全部作品", "仅中文/华语作品", "关闭媒体翻译"], optionValues: ["all", "chinese_only", "off"], tag: "媒体翻译范围", desc: "中文/华语模式按 Trakt 的 language/country 判断" },
    { key: "characterTranslationEnabled", defaultValue: true, type: "boolean", tag: "用豆瓣翻译角色名", desc: "启用后使用豆瓣翻译角色名" },
    { key: "playerInjectionEnabled", defaultValue: true, type: "boolean", tag: "播放器注入", desc: "播放器注入总开关" },
    { key: "eplayerxButtonOrder", defaultValue: 1, type: "select", options: ["1", "2", "3", "0"], optionValues: [1, 2, 3, 0], tag: "EplayerX 跳转按钮", desc: "序号代表排序位置，0 不显示" },
    { key: "forwardButtonOrder", defaultValue: 1, type: "select", options: ["1", "2", "3", "0"], optionValues: [1, 2, 3, 0], tag: "Forward 跳转按钮", desc: "序号代表排序位置，0 不显示" },
    { key: "infuseButtonOrder", defaultValue: 2, type: "select", options: ["1", "2", "3", "0"], optionValues: [1, 2, 3, 0], tag: "Infuse 跳转按钮", desc: "序号代表排序位置，0 不显示" },
    { key: "rexButtonOrder", defaultValue: 3, type: "select", options: ["1", "2", "3", "0"], optionValues: [1, 2, 3, 0], tag: "Rex 跳转按钮", desc: "序号代表排序位置，0 不显示" },
    { key: "backendBaseUrl", defaultValue: DEFAULT_BACKEND_BASE_URL, type: "text", tag: "翻译缓存接口", desc: "用于批量获取 Trakt 中文翻译，一般留空即可" },
    { key: "debugMode", defaultValue: "off", type: "select", options: ["关闭", "禁用本地缓存", "禁用远端缓存", "禁用所有缓存"], optionValues: ["off", "disableLocal", "disableRemote", "disableAll"], tag: "调试模式", desc: "控制本地与远端缓存" },
];'''
manifest = manifest[:start] + argument_fields + manifest[end:]
write("module-manifest.mjs", manifest)

# Remove the old source-level helper injection completely. If the old helper
# declarations are still present in a previously generated checkout, remove
# them once; no new declaration is ever inserted into this upstream file.
helper = read("shared/trakt-translation-helper.mjs")
for name in ("isChineseProductionRef", "shouldTranslateMediaRef"):
    pattern = re.compile(rf"(?ms)^[ \t]*(?:export\s+)?function\s+{re.escape(name)}\s*\([^{{]*\{{")
    while True:
        m = pattern.search(helper)
        if not m:
            break
        brace = helper.find("{", m.start())
        depth = 0
        quote = None
        escaped = False
        end = None
        for i in range(brace, len(helper)):
            ch = helper[i]
            if quote:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == quote:
                    quote = None
                continue
            if ch in ("'", '"', "`"):
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end is None:
            raise SystemExit(f"Unbalanced braces while removing {name}")
        nl = helper.find("\n", end)
        nl = len(helper) if nl < 0 else nl + 1
        helper = helper[:m.start()] + helper[nl:]
write("shared/trakt-translation-helper.mjs", helper)

# Create an independent policy module. This file is ours, so upstream changes
# to translation-helper.mjs cannot create duplicate declarations here.
policy = '''const CN_COUNTRIES = new Set(["cn", "hk", "tw", "sg", "mo"]);

export function isChineseProduction(ref) {
    const language = String(ref?.language ?? "").trim().toLowerCase();
    const raw = Array.isArray(ref?.country) ? ref.country : [ref?.country];
    const countries = raw
        .flatMap((value) => String(value ?? "").split(/[,|\\s]+/))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    return language === "zh" || countries.some((country) => CN_COUNTRIES.has(country));
}

export function shouldTranslateMedia(ref, argument = globalThis.$ctx?.argument ?? {}) {
    const engine = String(argument.translationEngine ?? "google").trim().toLowerCase();
    const scope = String(argument.translationScope ?? "all").trim().toLowerCase();
    if (engine === "off" || scope === "off") return false;
    return scope !== "chinese_only" || isChineseProduction(ref);
}
'''
policy_path = ROOT / "shared/translation-scope-policy.mjs"
policy_path.write_text(policy, encoding="utf-8")

# Export/import the policy through the existing helper without defining policy
# functions there. This is a stable one-line integration point.
helper = read("shared/trakt-translation-helper.mjs")
helper = replace_once(
    helper,
    'import { cacheUtils } from "./cache-utils.mjs";\n',
    'import { cacheUtils } from "./cache-utils.mjs";\nimport { shouldTranslateMedia, isChineseProduction } from "./translation-scope-policy.mjs";\n',
    "translation policy import",
)
write("shared/trakt-translation-helper.mjs", helper)

# Wire policy checks at the existing cache hydration/application boundaries.
media_helper = read("shared/trakt-translation-helper.mjs")
if "const translationRefsByType =" not in media_helper:
    media_helper = replace_once(
        media_helper,
        "    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n",
        '''    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);
    const translationRefsByType = Object.fromEntries(
        Object.entries(refsByType).map(([type, refs]) => [type, refs.filter((ref) => shouldTranslateMedia(ref))]),
    );
''',
        "translation ref filtering",
    )
media_helper = media_helper.replace("hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState)", "hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState)")
media_helper = media_helper.replace("fetchBulkTranslationsForMissing(cache, refsByType, backendState)", "fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState)")
media_helper = media_helper.replace("getMissingRefs(cache, mediaType, refsByType[mediaType])", "getMissingRefs(cache, mediaType, translationRefsByType[mediaType])")
media_helper = media_helper.replace("applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);", "if (shouldTranslateMedia(ref)) applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);")
write("shared/trakt-translation-helper.mjs", media_helper)

# Ensure detail responses carry language/country into the existing ref object.
media = read("features/media-translation.mjs")
if "translationScope" not in media:
    media = replace_once(
        media,
        "    const cache = cacheUtils.loadCache(context.env);\n",
        '''    const cache = cacheUtils.loadCache(context.env);
    if (!shouldTranslateMedia({ ...ref, language: data?.language, country: data?.country }, context.argument)) {
        return { type: "respond", body: JSON.stringify(data) };
    }
''',
        "detail translation scope",
    )
write("features/media-translation.mjs", media)

print("Translation scope/cache refactored to an independent policy module.")
