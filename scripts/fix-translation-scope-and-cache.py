from pathlib import Path

ROOT = Path("upstream/trakt_simplified_chinese/src")


def patch(path, replacements):
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    original = s
    for old, new in replacements:
        if old not in s:
            raise SystemExit(f"Patch anchor not found in {path}: {old[:160]!r}")
        s = s.replace(old, new, 1)
    if s == original:
        raise SystemExit(f"No changes made to {path}")
    p.write_text(s, encoding="utf-8")


# The translation cache is content-oriented, not mode-oriented: a cached Chinese
# translation is valid whenever the current scope says this media should translate.
# Therefore the scope must gate both cache reads/application and cache fetch/write.
patch("shared/trakt-translation-helper.mjs", [
    (
        """function applyTranslationsToItems(arr, cache, mediaConfig, applyTranslationFn) {\n    arr.forEach((item) => {\n        Object.keys(mediaConfig).forEach((mediaType) => {\n            const target = getItemMediaTarget(item, mediaType);\n            const ref = buildMediaRef(item, mediaType);\n            if (ref) {\n                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);\n            }\n        });\n    });\n}""",
        """function applyTranslationsToItems(arr, cache, mediaConfig, applyTranslationFn) {\n    arr.forEach((item) => {\n        Object.keys(mediaConfig).forEach((mediaType) => {\n            const target = getItemMediaTarget(item, mediaType);\n            const ref = buildMediaRef(item, mediaType);\n            if (ref && shouldTranslateMediaRef(ref)) {\n                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);\n            }\n        });\n    });\n}""",
    ),
    (
        """    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const shouldReplaceMediaImages = shouldReplaceImages();""",
        """    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const translationRefsByType = createMediaCollection(MEDIA_CONFIG);\n    Object.keys(MEDIA_CONFIG).forEach((mediaType) => {\n        translationRefsByType[mediaType] = refsByType[mediaType].filter((ref) => shouldTranslateMediaRef(ref));\n    });\n    const shouldReplaceMediaImages = shouldReplaceImages();""",
    ),
    (
        """    let cacheChanged = await hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState);\n\n    const bulkResult = await fetchBulkTranslationsForMissing(cache, refsByType, backendState);""",
        """    let cacheChanged = await hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState);\n\n    const bulkResult = await fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState);""",
    ),
    (
        """        const missingRefs = getMissingRefs(cache, mediaType, refsByType[mediaType]).slice(0, remainingDirectTranslationBudget);""",
        """        const missingRefs = getMissingRefs(cache, mediaType, translationRefsByType[mediaType]).slice(0, remainingDirectTranslationBudget);""",
    ),
])

# Episodes inherit language/country from their parent show. Without this, an
# episode ref can look "unknown" even though the show is clearly Chinese/non-Chinese.
patch("shared/trakt-translation-helper.mjs", [
    (
        """        sourceTitle: episode?.title ?? null,\n        availableTranslations:""",
        """        sourceTitle: episode?.title ?? null,\n        language: item?.show?.language ?? null,\n        country: item?.show?.country ?? null,\n        availableTranslations:""",
    ),
])

# In Chinese-only mode, people/actor translation is allowed only on a specific
# Chinese/Chinese-language media people page. This also prevents stale local or
# remote people-name cache entries from being applied to English productions.
patch("features/people-translation.mjs", [
    (
        """function buildPeopleListTmdbMediaType(target) {\n    if (!target) {\n        return null;\n    }\n\n    return target.mediaType === mediaTypes.MEDIA_TYPE.MOVIE ? mediaTypes.MEDIA_TYPE.MOVIE : mediaTypes.MEDIA_TYPE.SHOW;\n}\n\nasync function handleMediaPeopleList() {""",
        """function buildPeopleListTmdbMediaType(target) {\n    if (!target) {\n        return null;\n    }\n\n    return target.mediaType === mediaTypes.MEDIA_TYPE.MOVIE ? mediaTypes.MEDIA_TYPE.MOVIE : mediaTypes.MEDIA_TYPE.SHOW;\n}\n\nfunction isChineseTranslationScope() {\n    return String(globalThis.$ctx?.argument?.translationScope ?? \"all\").trim().toLowerCase() === \"chinese_only\";\n}\n\nasync function shouldTranslatePeopleTarget(target) {\n    if (!isChineseTranslationScope()) {\n        return true;\n    }\n    if (!target) {\n        return false;\n    }\n\n    try {\n        if (target.mediaType === mediaTypes.MEDIA_TYPE.EPISODE) {\n            const show = await mediaTranslationHelper.fetchMediaDetail(mediaTypes.MEDIA_TYPE.SHOW, target.showTraktId);\n            return mediaTranslationHelper.isChineseProductionRef(show);\n        }\n        const media = await mediaTranslationHelper.fetchMediaDetail(target.mediaType, target.traktId);\n        return mediaTranslationHelper.isChineseProductionRef(media);\n    } catch (error) {\n        globalThis.$ctx?.env?.log?.(`Chinese-only people scope check failed: ${error}`);\n        return false;\n    }\n}\n\nasync function handleMediaPeopleList() {""",
    ),
    (
        """    if (!target) {\n        return { type: \"passThrough\" };\n    }\n\n    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""",
        """    if (!target) {\n        return { type: \"passThrough\" };\n    }\n\n    if (!(await shouldTranslatePeopleTarget(target))) {\n        return { type: \"respond\", body: JSON.stringify(data) };\n    }\n\n    const cache = cacheUtils.loadPeopleTranslationCache(context.env);""",
    ),
    (
        """async function handlePersonMediaCreditsList() {\n    const data = commonUtils.parseJsonBody(globalThis.$ctx.responseBody);""",
        """async function handlePersonMediaCreditsList() {\n    if (isChineseTranslationScope()) {\n        return { type: \"passThrough\" };\n    }\n    const data = commonUtils.parseJsonBody(globalThis.$ctx.responseBody);""",
    ),
    (
        """async function handlePeopleSearchList() {\n    const context = globalThis.$ctx;""",
        """async function handlePeopleSearchList() {\n    const context = globalThis.$ctx;\n    if (isChineseTranslationScope()) {\n        return { type: \"passThrough\" };\n    }""",
    ),
    (
        """async function handlePeopleDetail() {\n    const context = globalThis.$ctx;""",
        """async function handlePeopleDetail() {\n    const context = globalThis.$ctx;\n    if (isChineseTranslationScope()) {\n        return { type: \"passThrough\" };\n    }""",
    ),
])

# The helper exports are required by the people feature above.
patch("shared/trakt-translation-helper.mjs", [
    (
        """    applyOverrideToTarget,\n    applyOverrideToTranslations,""",
        """    applyOverrideToTarget,\n    applyOverrideToTranslations,\n    isChineseProductionRef,""",
    ),
])

print("Translation scope/cache guard and people translation scope fixed.")
