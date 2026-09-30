"""Layer 2: isolated translation-scope policy.

One owner for scope behaviour: shared/translation-scope-policy.mjs. The upstream
helper only gets (a) one import, (b) refs filtered *before* any cache read/write
or API call, (c) a guard on cached-translation application. Upstream is cloned
fresh on every run, so no legacy cleanup is needed."""
from _common import fail, read, write

POLICY = '''// Countries treated as Chinese-language production markets (supporting signal).
const CN_COUNTRIES = new Set(["cn", "hk", "tw", "sg", "mo"]);

export function isChineseProduction(ref) {
    const language = String(ref?.language ?? "").trim().toLowerCase();
    const raw = Array.isArray(ref?.country) ? ref.country : [ref?.country];
    const countries = raw
        .flatMap((value) => String(value ?? "").split(/[,|\\s]+/))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    return language === "zh" || countries.some((country) => CN_COUNTRIES.has(country));
}

// translationScope only controls *media* text (title/overview/...). It is
// independent from translationEngine, which upstream uses solely to select the
// machine-translation backend; Trakt/backend translations are never gated by it.
export function shouldTranslateMedia(ref, argument = globalThis.$ctx?.argument ?? {}) {
    const scope = String(argument.translationScope ?? "all").trim().toLowerCase();
    if (scope === "off") return false;
    return scope !== "chinese_only" || isChineseProduction(ref);
}
'''
write("shared/translation-scope-policy.mjs", POLICY)

HELPER = "shared/trakt-translation-helper.mjs"
helper = read(HELPER)


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        fail(f"anchor not found: {label}")
    return text.replace(old, new, 1)


# (a) import, anchored on the upstream namespace import
IMPORT = 'import { shouldTranslateMedia } from "./translation-scope-policy.mjs";\n'
ANCHOR = 'import * as cacheUtils from "../utils/cache.mjs";\n'
helper = replace_once(helper, ANCHOR, ANCHOR + IMPORT, "cacheUtils import")

# Episode refs inherit the parent show's language/country: no extra Trakt request.
helper = replace_once(
    helper,
    "        availableTranslations: commonUtils.isArray(episode.available_translations) ? episode.available_translations : null,\n    };",
    "        availableTranslations: commonUtils.isArray(episode.available_translations) ? episode.available_translations : null,\n"
    "        language: item?.show?.language ?? null,\n        country: item?.show?.country ?? null,\n    };",
    "episode ref construction",
)

# (b) scope boundary: filter before any cache read/write or translation request
helper = replace_once(
    helper,
    "    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n",
    "    const refsByType = collectMediaRefs(items, MEDIA_CONFIG);\n"
    "    const translationRefsByType = Object.fromEntries(\n"
    "        Object.entries(refsByType).map(([type, refs]) => [type, refs.filter((ref) => shouldTranslateMedia(ref))]),\n"
    "    );\n",
    "refsByType boundary",
)
for old, new in (
    ("hydrateFromBackend(cache, refsByType, MEDIA_CONFIG, backendState)", "hydrateFromBackend(cache, translationRefsByType, MEDIA_CONFIG, backendState)"),
    ("fetchBulkTranslationsForMissing(cache, refsByType, backendState)", "fetchBulkTranslationsForMissing(cache, translationRefsByType, backendState)"),
    ("getMissingRefs(cache, mediaType, refsByType[mediaType])", "getMissingRefs(cache, mediaType, translationRefsByType[mediaType])"),
):
    helper = replace_once(helper, old, new, old)

# (c) cached translation application
helper = replace_once(
    helper,
    "                applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);",
    "                if (shouldTranslateMedia(ref)) applyTranslationFn(target, getCachedTranslation(cache, mediaType, ref), ref);",
    "cached translation application",
)

write(HELPER, helper)
print("Translation scope policy installed.")
