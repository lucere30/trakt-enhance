import assert from "node:assert/strict";
import test from "node:test";

import { buildFilms } from "../scripts/build-films.mjs";

function fakeTmdb(routes) {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
        if (!match) {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => match[1] };
    };
    return { fetchImpl, calls };
}

const quiet = () => {};

test("按片名和年份找到电影，取评分最高、不带文字的剧照", async () => {
    const { fetchImpl } = fakeTmdb({
        "query=Toy%20Story&year=1995": { results: [{ id: 862, backdrop_path: "/fallback.jpg" }] },
        "/movie/862/images": {
            backdrops: [
                { file_path: "/with-text.jpg", iso_639_1: "en", vote_average: 9 },
                { file_path: "/low.jpg", iso_639_1: null, vote_average: 4 },
                { file_path: "/best.jpg", iso_639_1: null, vote_average: 6 },
            ],
        },
    });
    const [film] = await buildFilms({
        films: [{ line: "飞向宇宙", original: "", source: "《玩具总动员》1995", search: { query: "Toy Story", year: 1995 } }],
        apiKey: "k",
        fetchImpl,
        log: quiet,
    });
    assert.equal(film.still, "https://image.tmdb.org/t/p/original/best.jpg");
    assert.equal(film.search, undefined, "输出里不带搜索条件");
});

test("年份对不上时不带年份重新搜索；剧照列表失败时用搜索结果自带的剧照", async () => {
    const { fetchImpl, calls } = fakeTmdb({
        "query=Casablanca&year=1942": { results: [] },
        "query=Casablanca": { results: [{ id: 289, backdrop_path: "/search.jpg" }] },
    });
    const [film] = await buildFilms({ films: [{ line: "x", original: "", source: "y", search: { query: "Casablanca", year: 1942 } }], apiKey: "k", fetchImpl, log: quiet });
    assert.equal(film.still, "https://image.tmdb.org/t/p/original/search.jpg");
    assert.equal(calls.filter((url) => url.includes("/search/movie")).length, 2);
});

test("TMDb 出错或没有 key 时该条不带剧照，不抛错", async () => {
    const failing = async () => {
        throw new Error("network down");
    };
    const films = [{ line: "x", original: "", source: "y", search: { query: "Anything", year: 2000 } }];
    assert.equal((await buildFilms({ films, apiKey: "k", fetchImpl: failing, log: quiet }))[0].still, null);
    assert.equal((await buildFilms({ films, apiKey: "", fetchImpl: failing, log: quiet }))[0].still, null);
});
