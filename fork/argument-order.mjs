// 调整 Loon 插件 [Argument] 段的显示顺序（只改各选项行的上下顺序）。
// 传给脚本的 argument=[{...}] 参数顺序和脚本本身都不变，因此不会出现参数错位。
// 在构建产物所在目录运行：node fork/argument-order.mjs <插件文件>
// 顺序取自 fork.config.json 的 argumentOrder：列表里没有的选项（例如上游新增的）按原顺序排在最后；
// 列表里有、插件里没有的选项直接跳过。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const forkDir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(forkDir, "fork.config.json"), "utf8"));
const order = Array.isArray(config.argumentOrder) ? config.argumentOrder : [];
const file = process.argv[2];

if (!file || order.length === 0) {
    console.log("argument-order: 未配置 argumentOrder 或未指定插件文件，跳过");
    process.exit(0);
}

const text = fs.readFileSync(file, "utf8");
const lines = text.split("\n");
const start = lines.findIndex((line) => line.trim() === "[Argument]");
if (start === -1) {
    console.log("argument-order: 插件里没有 [Argument] 段，跳过");
    process.exit(0);
}
let end = lines.findIndex((line, index) => index > start && /^\[.+\]\s*$/.test(line.trim()));
if (end === -1) {
    end = lines.length;
}

const body = lines.slice(start + 1, end);
const trailingBlank = [];
while (body.length > 0 && body[body.length - 1].trim() === "") {
    trailingBlank.unshift(body.pop());
}

const keyOf = (line) => line.match(/^\s*([A-Za-z0-9_]+)\s*=/)?.[1] ?? null;
if (body.some((line) => line.trim() !== "" && !keyOf(line))) {
    // 出现无法识别的行（注释、空行等），宁可不动也不打乱
    console.log("argument-order: [Argument] 段含无法识别的行，保持原顺序");
    process.exit(0);
}

const rank = new Map(order.map((key, index) => [key, index]));
const sorted = body
    .map((line, index) => ({ line, index, key: keyOf(line) }))
    .sort((a, b) => {
        const ra = rank.has(a.key) ? rank.get(a.key) : order.length + a.index;
        const rb = rank.has(b.key) ? rank.get(b.key) : order.length + b.index;
        return ra - rb;
    })
    .map((item) => item.line);

const next = [...lines.slice(0, start + 1), ...sorted, ...trailingBlank, ...lines.slice(end)].join("\n");
if (next !== text) {
    fs.writeFileSync(file, next, "utf8");
}
console.log(`argument-order: ${sorted.map(keyOf).join(" > ")}`);
