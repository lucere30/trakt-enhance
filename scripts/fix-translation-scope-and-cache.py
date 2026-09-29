from pathlib import Path
import re

ROOT = Path("upstream/trakt_simplified_chinese/src")


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Stable anchor not found for {label}: {old[:180]!r}")
    return text.replace(old, new, 1)


def insert_once(text, pattern, insertion, label):
    if insertion.strip() in text:
        return text
    match = re.search(pattern, text, flags=re.MULTILINE)
    if not match:
        raise SystemExit(f"Stable regex anchor not found for {label}: {pattern}")
    return text[:match.start()] + insertion + text[match.start():]


# ---------------------------------------------------------------------------
# Media translation scope
# ---------------------------------------------------------------------------
helper = read("shared/trakt-translation-helper.mjs")

if "function isChineseProductionRef(" not in helper:
    helper = insert_once(
        helper,
        r"(?m)^function applyTranslation\(userAgent, target, entry, mediaType = null\) \{",
        '''function isChineseProductionRef(ref) {\n    const language = String(ref?.language ?? "").trim().toLowerCase();\n    const countryValue = ref?.country;\n    const countries = Array.isArray(countryValue) ? countryValue : [countryValue];\n    const countrySet = new Set(countries.flatMap((value) => String(value ?? "").split(/[,|\\s]+/)).map((value) => value.trim().toLowerCase()).filter(Boolean));\n    return language === "zh" || ["cn", "hk", "tw", "sg", "mo"].some((country) => countrySet.has(country));\n}\n\nfunction shouldTranslateMediaRef(ref) {\n    const argument = globalThis.$ctx?.argument ?? {};\n    const engine = String(argument.translationEngine ?? "google").trim().toLowerCase();\n    const scope = String(argument.translationScope ?? "all").trim().toLowerCase();\n    if (engine === "off" || scope === "off") {\n        return false;\n    }\n    if (scope === "chinese_only") {\n        return isChineseProductionRef(ref);\n    }\n    return true;\n}\n\n''',
        "media translation scope helpers",
    )

# Episodes inherit the parent show's language/country.
if "language: item?.show?.language ?? null" not in helper:
    helper = replace_once(
        helper,
        "        sourceTitle: episode?.title ?? null,\n        availableTranslations:",
        "        sourceTitle: episode?.title ?? null,\n        language: item?.show?.language ?? null,\n        country: item?.show?.country ?? null,\n        availableTranslations:",
        "episode language inheritance",
    )

# Never apply stale cached translations when the current scope says not to.
helper = replace_once(
    helper,
    """            if (ref) {\n                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);\n            }""",
    """            if (ref && shouldTranslateMediaRef(ref)) {\n                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);\n            }""",
    "cache application scope guard",
) if "if (ref && shouldTranslateMediaRef(ref))" not in helper else helper

# Avoid remote/local cache work for media that cannot be translated under the current scope.
if "const translationRefsByType = createMediaCollection(MEDIA_CONFIG);" not in helper:
    helper = replace_once(
        helper,
        "    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const shouldReplaceMediaImages = shouldReplaceImages();",
        """    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const translationRefsByType = createMediaCollection(MEDIA_CONFIG);\n    Object.keys(MEDIA_CONFIG).forEach((mediaType) => {\n        translationRefsByType[mediaType] = refsByType[mediaType].filter((ref) => shouldTranslateMediaRef(ref));\n    });\n    const shouldReplaceMediaImages = shouldReplaceImages();""",
        "translation ref filtering",
    )

for old, new, label in [
    (
        "let cacheChanged = await hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState);",
        "let cacheChanged = await hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState);",
        "backend hydration scope",
    ),
    (
        "const bulkResult = await fetchBulkTranslationsForMissing(cache, refsByType, backendState);",
        "const bulkResult = await fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState);",
        "bulk translation scope",
    ),
    (
        "const missingRefs = getMissingRefs(cache, mediaType, refsByType[mediaType]).slice(0, remainingDirectTranslationBudget);",
        "const missingRefs = getMissingRefs(cache, mediaType, translationRefsByType[mediaType]).slice(0, remainingDirectTranslationBudget);",
        "direct translation scope",
    ),
]:
    if old in helper and new not in helper:
        helper = replace_once(helper, old, new, label)

# Detail translation: use the detail response's language/country before touching cache or API.
media = read("features/media-translation.mjs")
if "const shouldTranslate = traktTranslationHelper.shouldTranslateMediaRef" not in media:
    media = replace_once(
        media,
        """    const cache = cacheUtils.loadCache(context.env);\n    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);\n    let cacheChanged = false;\n    try {""",
        """    const cache = cacheUtils.loadCache(context.env);\n    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);\n    const translationRef = { ...ref, language: data?.language ?? ref?.language ?? null, country: data?.country ?? ref?.country ?? null };\n    const shouldTranslate = traktTranslationHelper.shouldTranslateMediaRef(translationRef);\n    let cacheChanged = false;\n    try {\n        if (!shouldTranslate) {\n            if (traktTranslationHelper.shouldReplaceImages()) {\n                await traktTranslationHelper.replaceImagesInPlace(data, mediaType, {\n                    ...translationRef,\n                    tmdbId: data?.ids?.tmdb ?? null,\n                    imageMode: context.argument.posterImageMode,\n                });\n            }\n            return { type: \"respond\", body: JSON.stringify(data) };\n        }\n\n        try {""",
        "detail translation scope guard",
    )
    # The inserted nested try needs its original catch to close the inner try; normalize the block.
    media = media.replace(
        """        context.env.log(`Trakt detail translation fetch failed: ${error}`);\n    }\n    if (cacheChanged) {""",
        """            context.env.log(`Trakt detail translation fetch failed: ${error}`);\n        }\n    }\n    if (cacheChanged) {""",
        1,
    )

# Actor/people translation: in Chinese-only mode, determine the parent media once.
people = read("features/people-translation.mjs")
if "async function shouldTranslatePeopleTarget(" not in people:
    people = insert_once(
        people,
        r"(?m)^async function handleMediaPeopleList\(\) \{",
        '''function isChineseOnlyScope() {\n    return String(globalThis.$ctx?.argument?.translationScope ?? "all").trim().toLowerCase() === "chinese_only";\n}\n\nasync function shouldTranslatePeopleTarget(target) {\n    if (!isChineseOnlyScope()) {\n        return true;\n    }\n    if (!target) {\n        return false;\n    }\n    try {\n        const media = target.mediaType === mediaTypes.MEDIA_TYPE.EPISODE\n            ? await mediaTranslationHelper.fetchMediaDetail(mediaTypes.MEDIA_TYPE.SHOW, target.showTraktId)\n            : await mediaTranslationHelper.fetchMediaDetail(target.mediaType, target.traktId);\n        return mediaTranslationHelper.isChineseProductionRef(media);\n    } catch (error) {\n        globalThis.$ctx?.env?.log?.(`Chinese-only people scope check failed: ${error}`);\n        return false;\n    }\n}\n\n''',
        "people media scope helper",
    )
    people = replace_once(
        people,
        """    if (!target) {\n        return { type: \"passThrough\" };\n    }\n\n    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""",
        """    if (!target) {\n        return { type: \"passThrough\" };\n    }\n\n    if (!(await shouldTranslatePeopleTarget(target))) {\n        return { type: \"respond\", body: JSON.stringify(data) };\n    }\n\n    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""",
        "people list scope guard",
    )

# Standalone person/search pages have no reliable parent production context; don't translate them in Chinese-only mode.
if "if (isChineseOnlyScope()) {\n        return { type: \"passThrough\" };" not in people:
    people = re.sub(
        r"(?m)^(async function handlePersonMediaCreditsList\(\) \{\n)",
        r'\1    if (isChineseOnlyScope()) {\n        return { type: "passThrough" };\n    }\n',
        people,
        count=1,
    )
    people = re.sub(
        r"(?m)^(async function handlePeopleSearchList\(\) \{\n)",
        r'\1    if (isChineseOnlyScope()) {\n        return { type: "passThrough" };\n    }\n',
        people,
        count=1,
    )
    people = re.sub(
        r"(?m)^(async function handlePeopleDetail\(\) \{\n)",
        r'\1    if (isChineseOnlyScope()) {\n        return { type: "passThrough" };\n    }\n',
        people,
        count=1,
    )

# Export helper used by people-translation.
if "isChineseProductionRef," not in helper:
    helper = replace_once(
        helper,
        "    isPosterImageReplacementUserAgent,\n",
        "    isChineseProductionRef,\n    isPosterImageReplacementUserAgent,\n",
        "Chinese production helper export",
    )

write("shared/trakt-translation-helper.mjs", helper)
write("features/media-translation.mjs", media)
write("features/people-translation.mjs", people)

print("Translation scope, stale-cache protection, and people translation scope applied.")
