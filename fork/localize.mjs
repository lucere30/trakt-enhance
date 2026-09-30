// 把仓库里指向上游仓库（DemoJameson/Proxy.Modules）的链接改成指向本仓库。
// 幂等：重复运行不会产生额外改动。在仓库根目录运行：node fork/localize.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const forkDir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(forkDir, "fork.config.json"), "utf8"));
const root = process.cwd();

const up = config.upstreamRepo; // DemoJameson/Proxy.Modules
const upBranch = config.upstreamBranch; // main
const me = config.repo; // lucere30/trakt-enhance
const myBranch = config.branch; // main

const enc = (s) => encodeURIComponent(s);
const esc = (s) => s.replace(/[/.]/g, (c) => `\\${c}`);

// 先替换带分支的形式（分支名后面是 / 或引号等非路径字符都算），再替换通用形式
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const branchTail = "(?=[^A-Za-z0-9._-]|$)";
const replacements = [
    [new RegExp(`raw\\.githubusercontent\\.com/${escapeRegExp(up)}/${escapeRegExp(upBranch)}${branchTail}`, "g"), `raw.githubusercontent.com/${me}/${myBranch}`],
    [new RegExp(`github\\.com/${escapeRegExp(up)}/tree/${escapeRegExp(upBranch)}${branchTail}`, "g"), `github.com/${me}/tree/${myBranch}`],
    [new RegExp(`${escapeRegExp(enc(up))}${escapeRegExp(enc("/"))}${escapeRegExp(upBranch)}${branchTail}`, "g"), `${enc(me)}${enc("/")}${enc(myBranch)}`],
    [up, me],
    [enc(up), enc(me)],
    [esc(up), esc(me)],
];

// 不改：许可证、本定制目录、工作流、锁文件
const skip = [/^LICENSE$/, /^fork\//, /^\.github\//, /^package-lock\.json$/, /(^|\/)node_modules\//];
const textExt = /\.(m?js|json|md|html|plugin|sgmodule|snippet|txt|ya?ml|css)$/i;

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && textExt.test(f) && !skip.some((re) => re.test(f)));

let changed = 0;
for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const before = fs.readFileSync(full, "utf8");
    let after = before;
    for (const [from, to] of replacements) {
        if (from instanceof RegExp) {
            after = after.replace(from, to);
        } else if (from !== to) {
            after = after.split(from).join(to);
        }
    }
    if (after !== before) {
        fs.writeFileSync(full, after, "utf8");
        changed += 1;
        console.log(`localized: ${file}`);
    }
}
console.log(`localize: ${changed} file(s) changed (${up} -> ${me})`);
