import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { invoke } from "./helpers/backend-v2.mjs";

const require = createRequire(import.meta.url);
const redirectHandler = require("../api/redirect.js");

const ALLOWED = [
    "infuse://movie/550",
    "infuse://series/108978-1-2",
    "https://eplayerx.com/tmdb-info/detail?type=movie&id=550",
    "https://fwds.cc/tmdb?type=tv&id=108978",
    "https://rexnow.tv/tmdb?type=movie&id=278",
];

const BLOCKED = [
    "https://evil.example/phish",
    "http://eplayerx.com/tmdb-info/detail?type=movie&id=550",
    "https://eplayerx.com.evil.example/x",
    "https://user:pass@fwds.cc/tmdb",
    "javascript:alert(1)",
    "data:text/html,hi",
    "//evil.example",
    "not a url",
];

test("重定向接口放行插件生成的播放器链接", async () => {
    for (const deeplink of ALLOWED) {
        const res = await invoke(redirectHandler, { query: { deeplink } });
        assert.equal(res.statusCode, 302, deeplink);
        assert.equal(res.headers.Location, deeplink);
    }
});

test("重定向接口拒绝其他链接，不做开放重定向", async () => {
    for (const deeplink of BLOCKED) {
        const res = await invoke(redirectHandler, { query: { deeplink } });
        assert.equal(res.statusCode, 400, deeplink);
        assert.equal(res.headers.Location, undefined, deeplink);
    }
});
