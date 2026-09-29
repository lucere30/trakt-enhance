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


def insert_before(text, pattern, block, label):
    if block.strip() in text:
        return text
    m = re.search(pattern, text, re.MULTILINE)
    if not m:
        raise SystemExit(f"Anchor not found: {label}")
    return text[:m.start()] + block + text[m.start():]


# Repair the public argument insertion performed by older customization scripts.
# This keeps the workflow self-healing while the next upstream-compatible
# customization script version is rolled out.
manifest = read("module-manifest.mjs")
for key in ["historyRequestEnhancementEnabled", "translationScope", "playerInjectionEnabled"]:
    # Older script inserted a complete object immediately before the key line,
    # leaving the original object's opening brace in the wrong place. Normalize
    # that exact malformed shape if present.
    pattern = rf'(\n    \{{\n)(        key: "{re.escape(key)}",.*?\n    \}},\n)(        key: "(?:translationEngine|characterTranslationEnabled|forwardButtonOrder)",)'
    match = re.search(pattern, manifest, flags=re.DOTALL)
    if match:
        block = match.group(2)
        # The malformed sequence contains an orphaned key line after the new block.
        replacement = f"\n    {{\n{block}    {{\n{match.group(3)}"
        manifest = manifest[:match.start()] + replacement + manifest[match.end():]
write("module-manifest.mjs", manifest)

# Media scope and cache gating. The cache remains content-based; scope decides
# whether a cached translation is allowed to be read/applied for this request.
helper = read("shared/trakt-translation-helper.mjs")
if "function isChineseProductionRef(" not in helper:
    helper = insert_before(helper, r"(?m)^function applyTranslation\(", '''function isChineseProductionRef(ref) {\n    const language = String(ref?.language ?? "").trim().toLowerCase();\n    const rawCountry = ref?.country;\n    const countries = Array.isArray(rawCountry) ? rawCountry : [rawCountry];\n    const countrySet = new Set(countries.flatMap((value) => String(value ?? "").split(/[,|\\s]+/)).map((value) => value.trim().toLowerCase()).filter(Boolean));\n    return language === "zh" || ["cn", "hk", "tw", "sg", "mo"].some((country) => countrySet.has(country));\n}\n\nfunction shouldTranslateMediaRef(ref) {\n    const argument = globalThis.$ctx?.argument ?? {};\n    const engine = String(argument.translationEngine ?? "google").trim().toLowerCase();\n    const scope = String(argument.translationScope ?? "all").trim().toLowerCase();\n    if (engine === "off" || scope === "off") return false;\n    return scope !== "chinese_only" || isChineseProductionRef(ref);\n}\n\n''', "media scope helpers")

if "language: item?.show?.language ?? null" not in helper:
    helper = require_replace(helper, "        sourceTitle: episode?.title ?? null,\n        availableTranslations:", "        sourceTitle: episode?.title ?? null,\n        language: item?.show?.language ?? null,\n        country: item?.show?.country ?? null,\n        availableTranslations:", "episode language inheritance")

if "if (ref && shouldTranslateMediaRef(ref))" not in helper:
    helper = require_replace(helper, """            if (ref) {\n                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);\n            }""", """            if (ref && shouldTranslateMediaRef(ref)) {\n                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);\n            }""", "cached translation application guard")

if "const translationRefsByType = createMediaCollection(MEDIA_CONFIG);" not in helper:
    helper = require_replace(helper, "    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const shouldReplaceMediaImages = shouldReplaceImages();", """    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const translationRefsByType = createMediaCollection(MEDIA_CONFIG);\n    Object.keys(MEDIA_CONFIG).forEach((mediaType) => {\n        translationRefsByType[mediaType] = refsByType[mediaType].filter((ref) => shouldTranslateMediaRef(ref));\n    });\n    const shouldReplaceMediaImages = shouldReplaceImages();""", "translation ref filtering")

helper = helper.replace("hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState)", "hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState)")
helper = helper.replace("fetchBulkTranslationsForMissing(cache, refsByType, backendState)", "fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState)")
helper = helper.replace("getMissingRefs(cache, mediaType, refsByType[mediaType])", "getMissingRefs(cache, mediaType, translationRefsByType[mediaType])")

if "isChineseProductionRef," not in helper:
    helper = require_replace(helper, "    isPosterImageReplacementUserAgent,\n", "    isChineseProductionRef,\n    isPosterImageReplacementUserAgent,\n", "helper export")
write("shared/trakt-translation-helper.mjs", helper)

media = read("features/media-translation.mjs")
if "const shouldTranslate = traktTranslationHelper.shouldTranslateMediaRef" not in media:
    media = require_replace(media, """    const cache = cacheUtils.loadCache(context.env);\n    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);\n    let cacheChanged = false;\n    try {""", """    const cache = cacheUtils.loadCache(context.env);\n    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);\n    const translationRef = { ...ref, language: data?.language ?? ref?.language ?? null, country: data?.country ?? ref?.country ?? null };\n    const shouldTranslate = traktTranslationHelper.shouldTranslateMediaRef(translationRef);\n    let cacheChanged = false;\n    if (!shouldTranslate) {\n        if (traktTranslationHelper.shouldReplaceImages()) {\n            await traktTranslationHelper.replaceImagesInPlace(data, mediaType, {\n                ...translationRef,\n                tmdbId: data?.ids?.tmdb ?? null,\n                imageMode: context.argument.posterImageMode,\n            });\n        }\n        return { type: "respond", body: JSON.stringify(data) };\n    }\n    try {""", "detail scope guard")
write("features/media-translation.mjs", media)

people = read("features/people-translation.mjs")
if "async function shouldTranslatePeopleTarget(" not in people:
    people = insert_before(people, r"(?m)^async function handleMediaPeopleList\(\) \{", '''function isChineseOnlyScope() {\n    return String(globalThis.$ctx?.argument?.translationScope ?? "all").trim().toLowerCase() === "chinese_only";\n}\n\nasync function shouldTranslatePeopleTarget(target) {\n    if (!isChineseOnlyScope()) return true;\n    if (!target) return false;\n    try {\n        const media = target.mediaType === mediaTypes.MEDIA_TYPE.EPISODE\n            ? await mediaTranslationHelper.fetchMediaDetail(mediaTypes.MEDIA_TYPE.SHOW, target.showTraktId)\n            : await mediaTranslationHelper.fetchMediaDetail(target.mediaType, target.traktId);\n        return mediaTranslationHelper.isChineseProductionRef(media);\n    } catch (error) {\n        globalThis.$ctx?.env?.log?.(`Chinese-only people scope check failed: ${error}`);\n        return false;\n    }\n}\n\n''', "people scope helper")
if "await shouldTranslatePeopleTarget(target)" not in people:
    people = require_replace(people, """    if (!target) {\n        return { type: \"passThrough\" };\n    }\n\n    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""", """    if (!target) {\n        return { type: \"passThrough\" };\n    }\n\n    if (!(await shouldTranslatePeopleTarget(target))) {\n        return { type: \"respond\", body: JSON.stringify(data) };\n    }\n\n    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""", "people list scope guard")
for name in ["handlePersonMediaCreditsList", "handlePeopleSearchList", "handlePeopleDetail"]:
    marker = f"async function {name}() {{\n"
    guard = '    if (isChineseOnlyScope()) return { type: "passThrough" };\n'
    if marker in people and guard.strip() not in people[people.index(marker):people.index(marker) + 180]:
        people = people.replace(marker, marker + guard, 1)
write("features/people-translation.mjs", people)

print("Translation scope, cache safety, detail gating, and people gating applied.")
