from pathlib import Path
import re

ROOT = Path("upstream/trakt_simplified_chinese/src")


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def require_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Anchor not found: {label}")
    return text.replace(old, new, 1)


def remove_function_declarations(source, name):
    """Remove every top-level declaration of name, including export function."""
    pattern = re.compile(rf"(?m)^(?:export\s+)?function\s+{re.escape(name)}\s*\(")
    while True:
        match = pattern.search(source)
        if not match:
            return source
        start = match.start()
        brace_start = source.find("{", match.end())
        if brace_start < 0:
            raise SystemExit(f"Cannot locate body for {name}")
        depth = 0
        quote = None
        escaped = False
        end = None
        for i in range(brace_start, len(source)):
            ch = source[i]
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
            raise SystemExit(f"Unbalanced braces in {name}")
        line_end = source.find("\n", end)
        if line_end < 0:
            line_end = len(source)
        else:
            line_end += 1
        source = source[:start] + source[line_end:]


def insert_before(text, pattern, block, label):
    m = re.search(pattern, text, re.MULTILINE)
    if not m:
        raise SystemExit(f"Anchor not found: {label}")
    return text[:m.start()] + block + text[m.start():]


# This is the only script that owns translation-scope/cache customization.
# It is deliberately self-contained and idempotent: every run first removes
# our helper declarations (including export variants), then installs exactly
# one canonical implementation. No second cleanup patch is required.

# Normalize the argumentFields array after the legacy EplayerX restoration and
# custom controls. Rebuilding this small declarative section avoids fragile
# brace-level patching and gives every future upstream build the same schema.
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

helper = read("shared/trakt-translation-helper.mjs")
# Remove any previous/custom declaration variants before installing the one
# canonical implementation. This specifically handles upstream `export`
# declarations, which the old deduper failed to recognize.
for helper_name in ("isChineseProductionRef", "shouldTranslateMediaRef"):
    helper = remove_function_declarations(helper, helper_name)

helper_block = r'''function isChineseProductionRef(ref) {
    const language = String(ref?.language ?? "").trim().toLowerCase();
    const rawCountry = ref?.country;
    const countries = Array.isArray(rawCountry) ? rawCountry : [rawCountry];
    const countrySet = new Set(countries.flatMap((value) => String(value ?? "").split(/[,|\s]+/)).map((value) => value.trim().toLowerCase()).filter(Boolean));
    return language === "zh" || ["cn", "hk", "tw", "sg", "mo"].some((country) => countrySet.has(country));
}

function shouldTranslateMediaRef(ref) {
    const argument = globalThis.$ctx?.argument ?? {};
    const engine = String(argument.translationEngine ?? "google").trim().toLowerCase();
    const scope = String(argument.translationScope ?? "all").trim().toLowerCase();
    if (engine === "off" || scope === "off") return false;
    return scope !== "chinese_only" || isChineseProductionRef(ref);
}

'''
helper = insert_before(helper, r"(?m)^function applyTranslation\(", helper_block, "canonical media scope helpers")

if "language: item?.show?.language ?? null" not in helper:
    helper = require_replace(helper, "        sourceTitle: episode?.title ?? null,\n        availableTranslations:", "        sourceTitle: episode?.title ?? null,\n        language: item?.show?.language ?? null,\n        country: item?.show?.country ?? null,\n        availableTranslations:", "episode language inheritance")
if "if (ref && shouldTranslateMediaRef(ref))" not in helper:
    helper = require_replace(helper, """            if (ref) {
                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);
            }""", """            if (ref && shouldTranslateMediaRef(ref)) {
                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);
            }""", "cached translation application guard")
if "const translationRefsByType = createMediaCollection(MEDIA_CONFIG);" not in helper:
    helper = require_replace(helper, "    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const shouldReplaceMediaImages = shouldReplaceImages();", """    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);
    const translationRefsByType = createMediaCollection(MEDIA_CONFIG);
    Object.keys(MEDIA_CONFIG).forEach((mediaType) => {
        translationRefsByType[mediaType] = refsByType[mediaType].filter((ref) => shouldTranslateMediaRef(ref));
    });
    const shouldReplaceMediaImages = shouldReplaceImages();""", "translation ref filtering")
helper = helper.replace("hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState)", "hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState)")
helper = helper.replace("fetchBulkTranslationsForMissing(cache, refsByType, backendState)", "fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState)")
helper = helper.replace("getMissingRefs(cache, mediaType, refsByType[mediaType])", "getMissingRefs(cache, mediaType, translationRefsByType[mediaType])")

if "isChineseProductionRef,\n" not in helper:
    helper = require_replace(helper, "    isPosterImageReplacementUserAgent,\n", "    isChineseProductionRef,\n    isPosterImageReplacementUserAgent,\n", "helper export")

if len(re.findall(r"(?m)^function\s+isChineseProductionRef\s*\(", helper)) != 1:
    raise SystemExit("Expected exactly one isChineseProductionRef declaration")
if len(re.findall(r"(?m)^function\s+shouldTranslateMediaRef\s*\(", helper)) != 1:
    raise SystemExit("Expected exactly one shouldTranslateMediaRef declaration")
write("shared/trakt-translation-helper.mjs", helper)

media = read("features/media-translation.mjs")
if "const translationRef = { ...ref, language:" not in media:
    media = require_replace(media, """    const cache = cacheUtils.loadCache(context.env);
    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);
    let cacheChanged = false;
    try {""", """    const cache = cacheUtils.loadCache(context.env);
    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);
    const translationRef = { ...ref, language: data?.language ?? ref?.language ?? null, country: data?.country ?? ref?.country ?? null };
    const shouldTranslate = traktTranslationHelper.shouldTranslateMediaRef(translationRef);
    let cacheChanged = false;
    if (!shouldTranslate) {
        if (traktTranslationHelper.shouldReplaceImages()) {
            await traktTranslationHelper.replaceImagesInPlace(data, mediaType, {
                ...translationRef,
                tmdbId: data?.ids?.tmdb ?? null,
                imageMode: context.argument.posterImageMode,
            });
        }
        return { type: "respond", body: JSON.stringify(data) };
    }
    try {""", "detail scope guard")
write("features/media-translation.mjs", media)

people = read("features/people-translation.mjs")
if "async function shouldTranslatePeopleTarget(" not in people:
    people = insert_before(people, r"(?m)^async function handleMediaPeopleList\(\) \{", r'''function isChineseOnlyScope() {
    return String(globalThis.$ctx?.argument?.translationScope ?? "all").trim().toLowerCase() === "chinese_only";
}

async function shouldTranslatePeopleTarget(target) {
    if (!isChineseOnlyScope()) return true;
    if (!target) return false;
    try {
        const media = target.mediaType === mediaTypes.MEDIA_TYPE.EPISODE
            ? await mediaTranslationHelper.fetchMediaDetail(mediaTypes.MEDIA_TYPE.SHOW, target.showTraktId)
            : await mediaTranslationHelper.fetchMediaDetail(target.mediaType, target.traktId);
        return mediaTranslationHelper.isChineseProductionRef(media);
    } catch (error) {
        globalThis.$ctx?.env?.log?.(`Chinese-only people scope check failed: ${error}`);
        return false;
    }
}

''', "people scope helper")
if "await shouldTranslatePeopleTarget(target)" not in people:
    people = require_replace(people, """    if (!target) {
        return { type: "passThrough" };
    }

    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""", """    if (!target) {
        return { type: "passThrough" };
    }

    if (!(await shouldTranslatePeopleTarget(target))) {
        return { type: "respond", body: JSON.stringify(data) };
    }

    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""", "people list scope guard")
for name in ["handlePersonMediaCreditsList", "handlePeopleSearchList", "handlePeopleDetail"]:
    marker = f"async function {name}() {{\n"
    if marker in people:
        start_pos = people.find(marker)
        prefix = people[start_pos:start_pos + 500]
        if "translationScope" not in prefix:
            people = people.replace(marker, marker + '    if (isChineseOnlyScope()) return { type: "passThrough" };\n', 1)
write("features/people-translation.mjs", people)

print("Translation scope/cache customization applied as one idempotent layer.")
