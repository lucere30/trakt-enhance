from pathlib import Path
import re

ROOT = Path('upstream/trakt_simplified_chinese/src')


def patch(path, replacements):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    original = s
    for old, new in replacements:
        if old not in s:
            raise SystemExit(f'Patch anchor not found in {path}: {old[:120]!r}')
        s = s.replace(old, new, 1)
    if s == original:
        raise SystemExit(f'No changes made to {path}')
    p.write_text(s, encoding='utf-8')


def patch_regex(path, pattern, replacement):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    s2, count = re.subn(pattern, replacement, s, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f'Regex patch anchor not found in {path}: {pattern!r}')
    p.write_text(s2, encoding='utf-8')


# 1) Public arguments: preserve upstream defaults, add only independent controls.
patch('module-manifest.mjs', [
    ('        key: "historyEpisodesMergedByShow",\n        defaultValue: true,\n        type: "boolean",\n        tag: "历史剧集按电视剧合并",\n        desc: "启用后会将历史页面电视剧类别的观看记录按电视剧合并",\n    },\n    {\n        key: "translationEngine",',
     '        key: "historyEpisodesMergedByShow",\n        defaultValue: true,\n        type: "boolean",\n        tag: "历史剧集按电视剧合并",\n        desc: "启用后会将历史页面电视剧类别的观看记录按电视剧合并",\n    },\n    {\n        key: "historyRequestEnhancementEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "历史请求增强",\n        desc: "启用后历史剧集请求的 limit 会提高，以减少分页；关闭后仍可保留历史记录合并功能",\n    },\n    {\n        key: "translationEngine",'),
    ('        key: "translationEngine",\n        defaultValue: "google",\n        type: "select",\n        options: ["谷歌翻译", "DeepLX", "关闭"],\n        optionValues: ["google", "deeplx", "off"],\n        tag: "翻译部分文本",\n        desc: "选择翻译引擎：谷歌翻译（快，需翻墙）、DeepLX（慢，可直连）、关闭",\n    },\n    {\n        key: "characterTranslationEnabled",',
     '        key: "translationEngine",\n        defaultValue: "google",\n        type: "select",\n        options: ["谷歌翻译", "DeepLX", "关闭"],\n        optionValues: ["google", "deeplx", "off"],\n        tag: "翻译部分文本",\n        desc: "选择翻译引擎：谷歌翻译（快，需翻墙）、DeepLX（慢，可直连）、关闭",\n    },\n    {\n        key: "translationScope",\n        defaultValue: "all",\n        type: "select",\n        options: ["全部作品", "仅中文/华语作品", "关闭媒体翻译"],\n        optionValues: ["all", "chinese_only", "off"],\n        tag: "媒体翻译范围",\n        desc: "全部作品按当前逻辑翻译；仅中文/华语作品根据 Trakt 的 language/country 判断；关闭媒体标题与简介翻译",\n    },\n    {\n        key: "characterTranslationEnabled",'),
    ('    {\n        key: "forwardButtonOrder",',
     '    {\n        key: "playerInjectionEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "播放器注入",\n        desc: "总开关：控制 Trakt/SofaTime 的播放器来源、Watch Now 和播放器 Logo 注入；关闭后保留各播放器单独配置",\n    },\n    {\n        key: "forwardButtonOrder",')
])

# 2) Normalize new enum so string/BoxJs/runtime arguments are consistent.
patch('argument.mjs', [
    ('function normalizeDebugMode(value) {',
     'function normalizeTranslationScope(value) {\n    const normalized = String(value ?? "").trim().toLowerCase();\n    const labelMap = {\n        全部作品: "all",\n        "仅中文/华语作品": "chinese_only",\n        关闭媒体翻译: "off",\n    };\n    if (labelMap[normalized]) {\n        return labelMap[normalized];\n    }\n    return ["all", "chinese_only", "off"].includes(normalized) ? normalized : "all";\n}\n\nfunction normalizeDebugMode(value) {'),
    ('        posterImageMode: normalizePosterImageMode(argument.posterImageMode),\n        translationEngine: normalizeTranslationEngine(argument.translationEngine),',
     '        posterImageMode: normalizePosterImageMode(argument.posterImageMode),\n        translationEngine: normalizeTranslationEngine(argument.translationEngine),\n        translationScope: normalizeTranslationScope(argument.translationScope),')
])

# 3) History request expansion gets its own switch; merge-by-show remains independent.
patch('features/history-episodes-merged-by-show.mjs', [
    ('function buildMergedHistoryEpisodesRequestUrl(url, shouldApply) {\n    return shouldApply ? buildMinimumLimitRequestUrl(url, HISTORY_EPISODES_LIMIT) : String(url.href);\n}',
     'function shouldEnhanceHistoryEpisodesRequest(url) {\n    const context = globalThis.$ctx;\n    const resolvedUrl = url ?? context.url;\n    return context.argument.historyRequestEnhancementEnabled && isTraktUserAgent() && isHistoryEpisodesListUrl(resolvedUrl);\n}\n\nfunction buildMergedHistoryEpisodesRequestUrl(url, shouldApply) {\n    return shouldApply ? buildMinimumLimitRequestUrl(url, HISTORY_EPISODES_LIMIT) : String(url.href);\n}'),
    ('async function handleMergedHistoryEpisodesRewriteRequest() {\n    const context = globalThis.$ctx;\n    if (!shouldMergeHistoryEpisodesByShow(context.url)) {',
     'async function handleMergedHistoryEpisodesRewriteRequest() {\n    const context = globalThis.$ctx;\n    if (!shouldEnhanceHistoryEpisodesRequest(context.url)) {')
])

# 4) Player injection master switch. Individual player order switches remain authoritative when master is on.
patch('features/player-injection-sofatime.mjs', [
    ('async function handleTmdbProviderCatalog() {\n    if (!isSofaTimeRequest()) {',
     'async function handleTmdbProviderCatalog() {\n    if (globalThis.$ctx.argument?.playerInjectionEnabled === false || !isSofaTimeRequest()) {'),
    ('async function handleTmdbDetailWatchProviders() {\n    const context = globalThis.$ctx;\n    if (!isSofaTimeRequest()) {',
     'async function handleTmdbDetailWatchProviders() {\n    const context = globalThis.$ctx;\n    if (context.argument?.playerInjectionEnabled === false || !isSofaTimeRequest()) {')
])

patch('features/player-injection-trakt.mjs', [
    ('async function handleWatchnow() {\n    const context = globalThis.$ctx;',
     'async function handleWatchnow() {\n    const context = globalThis.$ctx;\n    if (context.argument?.playerInjectionEnabled === false) {\n        return { type: "passThrough" };\n    }'),
    ('async function handleWatchnowSources() {\n    const payload = commonUtils.parseJsonBody(globalThis.$ctx.responseBody);',
     'async function handleWatchnowSources() {\n    if (globalThis.$ctx.argument?.playerInjectionEnabled === false) {\n        return { type: "passThrough" };\n    }\n    const payload = commonUtils.parseJsonBody(globalThis.$ctx.responseBody);'),
    ('    data.browsing.watchnow = commonUtils.ensureObject(data.browsing.watchnow);\n    data.browsing.watchnow.favorites = injectWatchnowFavoriteSources(data.browsing.watchnow.favorites, resolveWatchnowRegion(data.browsing.watchnow), orderedPlayerTypes);',
     '    data.browsing.watchnow = commonUtils.ensureObject(data.browsing.watchnow);\n    if (globalThis.$ctx.argument?.playerInjectionEnabled !== false) {\n        data.browsing.watchnow.favorites = injectWatchnowFavoriteSources(data.browsing.watchnow.favorites, resolveWatchnowRegion(data.browsing.watchnow), orderedPlayerTypes);\n    }'),
    ('async function handleDirectRedirectRequest() {\n    const context = globalThis.$ctx;',
     'async function handleDirectRedirectRequest() {\n    const context = globalThis.$ctx;\n    if (context.argument?.playerInjectionEnabled === false) {\n        return { type: "passThrough" };\n    }'),
    ('async function handleTmdbImageWebpRequest() {\n    const context = globalThis.$ctx;',
     'async function handleTmdbImageWebpRequest() {\n    const context = globalThis.$ctx;\n    if (context.argument?.playerInjectionEnabled === false) {\n        return { type: "passThrough" };\n    }')
])

# 5) Media translation scope. Trakt media objects expose language/country; use those fields rather than text heuristics.
patch('shared/trakt-translation-helper.mjs', [
    ('function applyTranslation(userAgent, target, entry, mediaType = null) {',
     'function isChineseProductionRef(ref) {\n    const language = String(ref?.language ?? "").trim().toLowerCase();\n    const country = String(ref?.country ?? "").trim().toLowerCase();\n    return language === "zh" || ["cn", "hk", "tw", "sg", "mo"].includes(country);\n}\n\nfunction shouldTranslateMediaRef(ref) {\n    const scope = String(globalThis.$ctx?.argument?.translationScope ?? "all").trim().toLowerCase();\n    if (scope === "off") {\n        return false;\n    }\n    if (scope === "chinese_only") {\n        return isChineseProductionRef(ref);\n    }\n    return true;\n}\n\nfunction applyTranslation(userAgent, target, entry, mediaType = null) {'),
    ('        sourceTitle: episode?.title ?? null,\n        availableTranslations:',
     '        sourceTitle: episode?.title ?? null,\n        language: item?.show?.language ?? null,\n        country: item?.show?.country ?? null,\n        availableTranslations:'),
    ('    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const shouldReplaceMediaImages = shouldReplaceImages();',
     '    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n    const translationRefsByType = createMediaCollection(MEDIA_CONFIG);\n    Object.keys(MEDIA_CONFIG).forEach((mediaType) => {\n        translationRefsByType[mediaType] = refsByType[mediaType].filter((ref) => shouldTranslateMediaRef(ref));\n    });\n    const shouldReplaceMediaImages = shouldReplaceImages();'),
    ('    let cacheChanged = await hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState);\n\n    const bulkResult = await fetchBulkTranslationsForMissing(cache, refsByType, backendState);',
     '    let cacheChanged = await hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState);\n\n    const bulkResult = await fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState);'),
    ('        const missingRefs = getMissingRefs(cache, mediaType, refsByType[mediaType]).slice(0, remainingDirectTranslationBudget);',
     '        const missingRefs = getMissingRefs(cache, mediaType, translationRefsByType[mediaType]).slice(0, remainingDirectTranslationBudget);'),
    ('    TRAKT_DIRECT_TRANSLATION_MAX_REFS,\n    translateMediaItemsInPlace,',
     '    TRAKT_DIRECT_TRANSLATION_MAX_REFS,\n    isChineseProductionRef,\n    shouldTranslateMediaRef,\n    translateMediaItemsInPlace,')
])

patch_regex(
    'shared/trakt-translation-helper.mjs',
    r'(?m)^(\s*)applyTranslation\(context\.userAgent, target, entry, ref\.mediaType\);\n(\s*)applyOverrideToTarget\(target, getOverrideFromTable\(overridesTable, ref\)\);',
    r'\1if (!shouldTranslateMediaRef(ref)) {\n\1    return;\n\1}\n\1applyTranslation(context.userAgent, target, entry, ref.mediaType);\n\2applyOverrideToTarget(target, getOverrideFromTable(overridesTable, ref));',
)

# 6) Detail translation must obey the same scope, while image replacement remains independent.
patch('features/media-translation.mjs', [
    ('    const cache = cacheUtils.loadCache(context.env);\n    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);\n    let cacheChanged = false;\n    try {\n        cacheChanged = await traktTranslationHelper.ensureDetailTranslation(\n            cache,\n            mediaType,\n            {',
     '    const cache = cacheUtils.loadCache(context.env);\n    const backendState = traktTranslationHelper.createBackendState(traktTranslationHelper.MEDIA_CONFIG);\n    const translationRef = { ...ref, language: data?.language ?? ref?.language ?? null, country: data?.country ?? ref?.country ?? null };\n    const shouldTranslate = traktTranslationHelper.shouldTranslateMediaRef(translationRef);\n    let cacheChanged = false;\n    try {\n        if (shouldTranslate) {\n            cacheChanged = await traktTranslationHelper.ensureDetailTranslation(\n                cache,\n                mediaType,\n                {'),
    ('            },\n            backendState,\n        );\n    } catch (error) {',
     '                },\n                backendState,\n            );\n        }\n    } catch (error) {'),
    ('    traktTranslationHelper.applyTranslation(context.userAgent, data, traktTranslationHelper.getCachedTranslation(cache, mediaType, ref), mediaType);\n\n    let override = null;',
     '    if (shouldTranslate) {\n        traktTranslationHelper.applyTranslation(context.userAgent, data, traktTranslationHelper.getCachedTranslation(cache, mediaType, ref), mediaType);\n    }\n\n    let override = null;'),
    ('        traktTranslationHelper.applyOverrideToTarget(data, override);',
     '        if (shouldTranslate) {\n            traktTranslationHelper.applyOverrideToTarget(data, override);\n        }'),
    ('    const fallbackPromise = googleFallbackTranslation.applyUncachedGoogleTranslation(context, [',
     '    const fallbackPromise = shouldTranslate ? googleFallbackTranslation.applyUncachedGoogleTranslation(context, ['),
    ('    ]);\n    if (traktTranslationHelper.shouldReplaceImages()) {',
     '    ]) : Promise.resolve(false);\n    if (traktTranslationHelper.shouldReplaceImages()) {')
])

print('Custom feature controls and Chinese-only media translation patches applied.')
