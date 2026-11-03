// 部署时运行（vercel.json 的 buildCommand）：按 site/films.json 去 TMDb 查每部电影的剧照，
// 写出首页使用的 public/films.json。查不到或 TMDb 不可用时该条不带剧照，不会让部署失败。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMDB_API = "https://api.themoviedb.org/3";
// 剧照铺满整个屏幕，用原图尺寸（老电影一般是 1920×1080）
const STILL_SIZE = "original";
const TIMEOUT_MS = 8000;

async function getJson(fetchImpl, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function findMovie(fetchImpl, apiKey, { query, year }) {
    const base = `${TMDB_API}/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`;
    // 先按年份找，年份对不上（上映日期跨年）再不带年份找
    for (const url of year ? [`${base}&year=${year}`, base] : [base]) {
        const result = (await getJson(fetchImpl, url))?.results?.[0];
        if (result) {
            return result;
        }
    }
    return null;
}

// 优先没有文字的剧照（iso_639_1 为空），按评分取最高
async function pickStill(fetchImpl, apiKey, movie) {
    try {
        const images = await getJson(fetchImpl, `${TMDB_API}/movie/${movie.id}/images?api_key=${encodeURIComponent(apiKey)}&include_image_language=null`);
        const best = (images?.backdrops ?? []).filter((image) => !image.iso_639_1).sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
        if (best?.file_path) {
            return best.file_path;
        }
    } catch {
        // 退回搜索结果自带的剧照
    }
    return movie.backdrop_path ?? null;
}

export async function buildFilms({ films, apiKey, fetchImpl = globalThis.fetch, log = console.log }) {
    const output = [];
    for (const film of films) {
        const { search, ...entry } = film;
        let still = null;
        if (apiKey && search?.query) {
            try {
                const movie = await findMovie(fetchImpl, apiKey, search);
                const filePath = movie ? await pickStill(fetchImpl, apiKey, movie) : null;
                still = filePath ? `https://image.tmdb.org/t/p/${STILL_SIZE}${filePath}` : null;
                log(`${search.query}: ${still ? "ok" : "no still"}`);
            } catch (error) {
                log(`${search.query}: lookup failed (${error instanceof Error ? error.message : error})`);
            }
        }
        output.push({ ...entry, still });
    }
    return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const films = JSON.parse(fs.readFileSync(path.join(root, "site", "films.json"), "utf8"));
    const apiKey = String(process.env.TMDB_API_KEY ?? "").trim();
    if (!apiKey) {
        console.log("TMDB_API_KEY 未设置：首页不带剧照");
    }
    const output = await buildFilms({ films, apiKey });
    fs.writeFileSync(path.join(root, "public", "films.json"), `${JSON.stringify(output, null, 4)}\n`);
    console.log(`films.json: ${output.length} 条，${output.filter((item) => item.still).length} 条带剧照`);
}
