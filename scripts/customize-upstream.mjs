import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? "upstream";
const moduleRoot = path.join(root, "trakt_simplified_chinese", "src");

function file(rel) {
    return path.join(moduleRoot, rel);
}

function read(rel) {
    return fs.readFileSync(file(rel), "utf8");
}

function write(rel, content) {
    fs.writeFileSync(file(rel), content, "utf8");
}

function replaceOnce(source, search, replacement, label) {
    if (!source.includes(search)) {
        throw new Error(`Customization anchor not found: ${label}`);
    }
    return source.replace(search, replacement);
}

function addManifestArguments() {
    const rel = "module-manifest.mjs";
    let s = read(rel);
    const anchor = `    {\n        key: "historyEpisodesMergedByShow",`;
    const insert = `    {\n        key: "mediaTranslationEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "剧集/电影中文化",\n        desc: "控制 Trakt 影视标题、简介、剧集等中文化处理；关闭后保留原始文本",\n    },\n    {\n        key: "mediaTranslationScope",\n        defaultValue: "all",\n        type: "select",\n        options: ["全部作品", "仅中文/华语作品"],\n        optionValues: ["all", "chinese"],\n        tag: "影视翻译范围",\n        desc: "仅中文/华语作品：根据 Trakt 的语言/地区字段判断；其它作品保持 Trakt 原始英文",\n    },\n    {\n        key: "historyRequestExpansionEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "历史请求放大",\n        desc: "将 History Episodes 请求的 limit 提高，以减少分页；独立于历史记录按电视剧合并",\n    },\n    {\n        key: "commentsTranslationEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "评论翻译",\n        desc: "翻译 Trakt 评论内容；关闭后评论保持原文",\n    },\n    {\n        key: "peopleTranslationEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "人物信息翻译",\n        desc: "翻译人物姓名、简介及影视演职员信息；角色名仍由独立开关控制",\n    },\n    {\n        key: "listsTranslationEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "列表翻译",\n        desc: "翻译 Trakt 列表名称和描述",\n    },\n    {\n        key: "sentimentsTranslationEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "评分观点翻译",\n        desc: "翻译 Trakt Sentiments 内容",\n    },\n    {\n        key: "videoTranslationEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "视频标题翻译",\n        desc: "翻译 Trakt 视频标题",\n    },\n    {\n        key: "playerInjectionEnabled",\n        defaultValue: true,\n        type: "boolean",\n        tag: "播放器注入",\n        desc: "总开关；关闭后不注入 EplayerX、Forward、Infuse、Rex，也不修改相关 Watch Now / SofaTime provider 数据",\n    },\n${anchor}`;
    s = replaceOnce(s, anchor, insert, "manifest feature arguments");
    write(rel, s);
}

function patchArgument() {
    const rel = "argument.mjs";
    let s = read(rel);
    s = s.replace(
        `        config[key] = commonUtils.parseArgumentValue(argument[key], config[key]);`,
        `        config[key] = commonUtils.parseArgumentValue(argument[key], config[key]);`,
    );
    s = replaceOnce(
        s,
        `    return {\n        ...argument,\n        posterImageMode: normalizePosterImageMode(argument.posterImageMode),`,
        `    return {\n        ...argument,\n        mediaTranslationEnabled: argument.mediaTranslationEnabled !== false,\n        mediaTranslationScope: ["all", "chinese"].includes(String(argument.mediaTranslationScope ?? "")) ? String(argument.mediaTranslationScope) : "all",\n        historyRequestExpansionEnabled: argument.historyRequestExpansionEnabled !== false,\n        commentsTranslationEnabled: argument.commentsTranslationEnabled !== false,\n        peopleTranslationEnabled: argument.peopleTranslationEnabled !== false,\n        listsTranslationEnabled: argument.listsTranslationEnabled !== false,\n        sentimentsTranslationEnabled: argument.sentimentsTranslationEnabled !== false,\n        videoTranslationEnabled: argument.videoTranslationEnabled !== false,\n        playerInjectionEnabled: argument.playerInjectionEnabled !== false,\n        posterImageMode: normalizePosterImageMode(argument.posterImageMode),`,
        "argument normalized feature switches",
    );
    write(rel, s);
}

function patchMediaTranslationBackend() {
    const rel = "shared/media-translation-backend.mjs";
    let s = read(rel);
    s = replaceOnce(
        s,
        `const TRANSLATION_NOT_FOUND_TTL_MS = 1 * 24 * 60 * 60 * 1000;`,
        `const TRANSLATION_NOT_FOUND_TTL_MS = 1 * 24 * 60 * 60 * 1000;\nconst CHINESE_MEDIA_LANGUAGES = new Set(["zh", "zh-cn", "zh-tw", "zh-hk", "cmn"]);\nconst CHINESE_MEDIA_COUNTRIES = new Set(["cn", "hk", "tw", "sg"]);`,
        "translation scope constants",
    );
    s = replaceOnce(
        s,
        `function hasZhAvailableTranslation(availableTranslations) {`,
        `function isChineseMediaRef(ref) {\n    const language = String(ref?.language ?? "").trim().toLowerCase();\n    const country = String(ref?.country ?? "").trim().toLowerCase();\n    if (CHINESE_MEDIA_LANGUAGES.has(language) || CHINESE_MEDIA_COUNTRIES.has(country)) {\n        return true;\n    }\n    return false;\n}\n\nfunction shouldSkipMediaTranslation(ref) {\n    const context = globalThis.$ctx;\n    if (context?.argument?.mediaTranslationEnabled === false) {\n        return true;\n    }\n    const scope = String(context?.argument?.mediaTranslationScope ?? "all").toLowerCase();\n    return scope === "chinese" && !isChineseMediaRef(ref);\n}\n\nfunction hasZhAvailableTranslation(availableTranslations) {`,
        "translation scope helpers",
    );
    s = replaceOnce(
        s,
        `function getMissingRefs(cache, mediaType, refs) {\n    return refs.filter((ref) => {\n        return ref && buildMediaCacheLookupKey(mediaType, ref) && !shouldSkipTranslationLookup(ref) && !getCachedTranslation(cache, mediaType, ref);\n    });\n}`,
        `function getMissingRefs(cache, mediaType, refs) {\n    return refs.filter((ref) => {\n        return ref && buildMediaCacheLookupKey(mediaType, ref) && !shouldSkipMediaTranslation(ref) && !shouldSkipTranslationLookup(ref) && !getCachedTranslation(cache, mediaType, ref);\n    });\n}`,
        "translation missing refs scope",
    );
    s = replaceOnce(
        s,
        `function getCachedTranslation(cache, mediaType, ref) {\n    const cacheKey = buildMediaCacheKey(mediaType, ref);`,
        `function getCachedTranslation(cache, mediaType, ref) {\n    if (shouldSkipMediaTranslation(ref)) {\n        return null;\n    }\n    const cacheKey = buildMediaCacheKey(mediaType, ref);`,
        "translation cached result scope",
    );
    s = replaceOnce(
        s,
        `    getMissingRefs,\n    getOverrideGroupName,`,
        `    getMissingRefs,\n    getOverrideGroupName,\n    isChineseMediaRef,\n    shouldSkipMediaTranslation,`,
        "translation scope exports",
    );
    write(rel, s);
}

function patchTranslationRefs() {
    const rel = "shared/trakt-translation-helper.mjs";
    let s = read(rel);
    s = replaceOnce(
        s,
        `        episodeTraktId: episode?.ids?.trakt ?? null,\n        backendLookupKey: buildEpisodeCompositeKey(showId, seasonNumber, episodeNumber),`,
        `        episodeTraktId: episode?.ids?.trakt ?? null,\n        language: episode?.language ?? item?.show?.language ?? null,\n        country: episode?.country ?? item?.show?.country ?? null,\n        backendLookupKey: buildEpisodeCompositeKey(showId, seasonNumber, episodeNumber),`,
        "episode media language metadata",
    );
    write(rel, s);
}

function patchHistory() {
    const rel = "features/history-episodes-merged-by-show.mjs";
    let s = read(rel);
    s = replaceOnce(
        s,
        `function buildMergedHistoryEpisodesRequestUrl(url, shouldApply) {\n    return shouldApply ? buildMinimumLimitRequestUrl(url, HISTORY_EPISODES_LIMIT) : String(url.href);\n}`,
        `function shouldExpandHistoryEpisodesRequest(url) {\n    const context = globalThis.$ctx;\n    return context.argument.historyRequestExpansionEnabled !== false && isTraktUserAgent() && isHistoryEpisodesListUrl(url ?? context.url);\n}\n\nfunction buildMergedHistoryEpisodesRequestUrl(url, shouldApply) {\n    return shouldApply && shouldExpandHistoryEpisodesRequest(url) ? buildMinimumLimitRequestUrl(url, HISTORY_EPISODES_LIMIT) : String(url.href);\n}`,
        "history request expansion switch",
    );
    s = replaceOnce(
        s,
        `    if (!shouldMergeHistoryEpisodesByShow(resolvedUrl)) {\n        return { type: "passThrough" };\n    }\n    return {\n        type: "rewriteRequest",\n        url: buildMergedHistoryEpisodesRequestUrl(context.url, true),\n    };`,
        `    if (!shouldExpandHistoryEpisodesRequest(resolvedUrl)) {\n        return { type: "passThrough" };\n    }\n    return {\n        type: "rewriteRequest",\n        url: buildMergedHistoryEpisodesRequestUrl(context.url, true),\n    };`,
        "history request rewrite independence",
    );
    s = replaceOnce(
        s,
        `export { handleMergedHistoryEpisodeList, handleMergedHistoryEpisodesRewriteRequest, shouldMergeHistoryEpisodesByShow };`,
        `export { handleMergedHistoryEpisodeList, handleMergedHistoryEpisodesRewriteRequest, shouldMergeHistoryEpisodesByShow, shouldExpandHistoryEpisodesRequest };`,
        "history export",
    );
    write(rel, s);
}

function patchPlayerInjection(rel, exportedNames) {
    let s = read(rel);
    const exportLine = `export { ${exportedNames.join(", ")} };`;
    const guards = exportedNames
        .map((name) => `async function ${name}WithSwitch(...args) {\n    if (globalThis.$ctx?.argument?.playerInjectionEnabled === false) {\n        return { type: "passThrough" };\n    }\n    return ${name}(...args);\n}`)
        .join("\n\n");
    const replacement = `${guards}\n\nexport { ${exportedNames.map((name) => `${name}WithSwitch as ${name}`).join(", ")} };`;
    s = replaceOnce(s, exportLine, replacement, `player injection ${rel} exports`);
    write(rel, s);
}

function patchFeatureSwitch(rel, exportedNames, argumentKey) {
    let s = read(rel);
    const exportLine = `export { ${exportedNames.join(", ")} };`;
    const guards = exportedNames
        .map((name) => `async function ${name}WithSwitch(...args) {\n    if (globalThis.$ctx?.argument?.${argumentKey} === false) {\n        return { type: "passThrough" };\n    }\n    return ${name}(...args);\n}`)
        .join("\n\n");
    const replacement = `${guards}\n\nexport { ${exportedNames.map((name) => `${name}WithSwitch as ${name}`).join(", ")} };`;
    s = replaceOnce(s, exportLine, replacement, `${argumentKey} exports`);
    write(rel, s);
}

function patchMediaFeature() {
    const rel = "features/media-translation.mjs";
    let s = read(rel);
    s = replaceOnce(
        s,
        `async function handleMediaDetail() {\n    const context = globalThis.$ctx;`,
        `async function handleMediaDetail() {\n    const context = globalThis.$ctx;`,
        "media detail anchor",
    );
    s = replaceOnce(
        s,
        `    const fallbackPromise = googleFallbackTranslation.applyUncachedGoogleTranslation(context, [`,
        `    const fallbackPromise = context.argument.mediaTranslationEnabled === false\n        ? Promise.resolve(false)\n        : googleFallbackTranslation.applyUncachedGoogleTranslation(context, [`,
        "media detail fallback gate",
    );
    s = replaceOnce(
        s,
        `    ]);\n    if (traktTranslationHelper.shouldReplaceImages()) {`,
        `    ]);\n    if (traktTranslationHelper.shouldReplaceImages()) {`,
        "media detail fallback close",
    );
    s = replaceOnce(
        s,
        `async function handleTranslations() {\n    const context = globalThis.$ctx;`,
        `async function handleTranslations() {\n    const context = globalThis.$ctx;\n    if (context.argument.mediaTranslationEnabled === false) {\n        return { type: "passThrough" };\n    }`,
        "media translations switch",
    );
    s = replaceOnce(
        s,
        `async function handleSeasonEpisodesList() {\n    const context = globalThis.$ctx;`,
        `async function handleSeasonEpisodesList() {\n    const context = globalThis.$ctx;`,
        "season list anchor",
    );
    write(rel, s);
}

function patchPluginRuntimeLinks() {
    // The upstream generated JS still contains the upstream homepage in metadata.
    const rel = "module-manifest.mjs";
    let s = read(rel);
    s = s.replace('const REPOSITORY_URL = "https://github.com/DemoJameson/Proxy.Modules";', 'const REPOSITORY_URL = "https://github.com/lucere30/trakt-enhance";');
    s = s.replace('const RAW_BASE_URL = "https://raw.githubusercontent.com/DemoJameson/Proxy.Modules/main";', 'const RAW_BASE_URL = "https://raw.githubusercontent.com/lucere30/trakt-enhance/main";');
    write(rel, s);
}

addManifestArguments();
patchArgument();
patchMediaTranslationBackend();
patchTranslationRefs();
patchHistory();
patchMediaFeature();
patchFeatureSwitch("features/comments-translation.mjs", ["handleComments", "handleRecentCommentsList"], "commentsTranslationEnabled");
patchFeatureSwitch("features/lists-translation.mjs", ["handleList"], "listsTranslationEnabled");
patchFeatureSwitch("features/people-translation.mjs", ["handleMediaPeopleList", "handlePeopleDetail", "handlePeopleSearchList", "handlePersonMediaCreditsList"], "peopleTranslationEnabled");
patchFeatureSwitch("features/sentiments-translation.mjs", ["handleSentiments"], "sentimentsTranslationEnabled");
patchFeatureSwitch("features/google-fallback-translation.mjs", ["handleMediaVideos"], "videoTranslationEnabled");
patchPlayerInjection("features/player-injection-trakt.mjs", ["handleDirectRedirectRequest", "handleTmdbImageWebpRequest", "handleUserSettings", "handleWatchnow", "handleWatchnowSources"]);
patchPlayerInjection("features/player-injection-sofatime.mjs", ["handleTmdbDetailWatchProviders", "handleTmdbProviderCatalog"]);
patchPluginRuntimeLinks();
console.log("Customization applied successfully.");
