// 只放行插件生成的播放器跳转链接，避免被当作开放重定向（用本站域名跳到任意网站）。
// 与 trakt_simplified_chinese/src/shared/player-definitions.mjs 里的链接保持一致。
const ALLOWED_SCHEMES = new Set(["infuse:"]);
const ALLOWED_HTTPS_HOSTS = new Set(["eplayerx.com", "fwds.cc", "rexnow.tv"]);

function isAllowedDeeplink(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (ALLOWED_SCHEMES.has(url.protocol)) {
        return true;
    }
    return url.protocol === "https:" && ALLOWED_HTTPS_HOSTS.has(url.hostname) && !url.username && !url.password;
}

module.exports = async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    const deeplink = typeof req.query.deeplink === "string" ? req.query.deeplink.trim() : "";

    if (!deeplink) {
        res.status(400).json({ error: "Missing deeplink query" });
        return;
    }

    if (!isAllowedDeeplink(deeplink)) {
        res.setHeader("Cache-Control", "no-store");
        res.status(400).json({ error: "Unsupported deeplink" });
        return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Location", deeplink);
    res.status(302).end();
};

module.exports.isAllowedDeeplink = isAllowedDeeplink;
