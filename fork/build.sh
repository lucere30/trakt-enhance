#!/usr/bin/env bash
# 手动构建插件：以底稿（fork.config.json 的 upstreamUrl / upstreamBranch，即本仓库的 upstream-mit 分支）
# 为基础，重放 fork/patches 里的定制补丁，改写链接，重新构建并跑测试；全部通过后只保留 Loon 插件
# 需要的文件（keep），连同本仓库自己维护的文件（overlay），在当前分支上生成一个提交。
#
# 用法（在仓库根目录）：bash fork/build.sh，确认无误后自己 git push。
# 任何一步失败都会非零退出，当前分支不变。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

cfg() { node -p "require('./fork/fork.config.json').$1"; }
BASE_URL="$(cfg upstreamUrl)"
BASE_BRANCH="$(cfg upstreamBranch)"
# 底稿 LICENSE 第一行必须是这个值，否则拒绝构建（见 fork/README.md「为什么停在 MIT 版本」）
REQUIRED_LICENSE="$(node -p "require('./fork/fork.config.json').requiredLicense || ''")"
mapfile -t OVERLAY_PATHS < <(node -p "require('./fork/fork.config.json').overlay.join('\n')")
mapfile -t KEEP_PATHS < <(node -p "require('./fork/fork.config.json').keep.join('\n')")
# 定制补丁自带的测试文件（上游 npm test 不会跑它们）
mapfile -t EXTRA_TESTS < <(node -p "(require('./fork/fork.config.json').extraTests || []).join('\n')" | sed '/^$/d')

fail() {
    echo "构建失败：$*" >&2
    echo "当前分支未改动。" >&2
    exit 1
}

git fetch --no-tags --quiet "$BASE_URL" "$BASE_BRANCH"
BASE_SHA="$(git rev-parse FETCH_HEAD)"
echo "底稿 $BASE_BRANCH：$BASE_SHA"

WT="$(mktemp -d)"
LOG="$(mktemp -d)"
cleanup() { cd "$ROOT"; git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; git worktree prune; rm -rf "$LOG"; }
trap cleanup EXIT
git worktree add --quiet --detach "$WT" "$BASE_SHA"
cd "$WT"

if [ -n "$REQUIRED_LICENSE" ] && [ "$(head -n 1 LICENSE 2>/dev/null)" != "$REQUIRED_LICENSE" ]; then
    fail "底稿 LICENSE 第一行是「$(head -n 1 LICENSE 2>/dev/null)」，要求「$REQUIRED_LICENSE」"
fi

# 底稿自己的 .github 不带进来
git rm -r -q --cached --ignore-unmatch .github
rm -rf .github

# 1) 重放定制补丁（3-way 合并）
shopt -s nullglob
for p in "$ROOT"/fork/patches/*.patch; do
    echo "应用补丁：$(basename "$p")"
    if ! git apply --3way --index --whitespace=nowarn "$p" 2> "$LOG/apply.log"; then
        cat "$LOG/apply.log" >&2
        git diff --name-only --diff-filter=U | sed 's/^/  冲突文件：/' >&2
        fail "补丁 $(basename "$p") 打不上，步骤见 fork/README.md「修改定制」"
    fi
done

# 2) 仓库链接和后端地址改为本仓库自己的
node "$ROOT/fork/localize.mjs"

# 3) 重新生成构建产物并跑测试。上游有几个后端测试检查「未配置 KV 时返回 500」，
#    所以测试时去掉 Redis/KV 相关的环境变量，免得本机设置了它们导致误报
TEST_ENV=(env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u KV_REST_API_URL -u KV_REST_API_TOKEN)
if ! { npm ci --no-audit --no-fund && "${TEST_ENV[@]}" npm test && { [ "${#EXTRA_TESTS[@]}" -eq 0 ] || "${TEST_ENV[@]}" node --test "${EXTRA_TESTS[@]}"; }; } > "$LOG/build.log" 2>&1; then
    tail -n 80 "$LOG/build.log" >&2
    fail "构建或测试未通过"
fi
tail -n 12 "$LOG/build.log"

# 3.5) 调整 Loon 插件选项的显示顺序（只改 [Argument] 段行序，不影响传给脚本的参数）
node "$ROOT/fork/argument-order.mjs" trakt_simplified_chinese/trakt_simplified_chinese.plugin

# 4) 只保留 Loon 插件需要的文件，再放回本仓库自己维护的文件
git read-tree --empty
for k in "${KEEP_PATHS[@]}"; do
    [ -e "$k" ] || fail "底稿里找不到需要保留的文件 $k（检查 fork/fork.config.json 的 keep）"
    git add -f -- "$k"
done
rm -rf -- "${OVERLAY_PATHS[@]}"
mapfile -t HEAD_OVERLAY < <(git -C "$ROOT" ls-tree --name-only HEAD -- "${OVERLAY_PATHS[@]}")
if [ "${#HEAD_OVERLAY[@]}" -gt 0 ]; then
    git -C "$ROOT" archive HEAD -- "${HEAD_OVERLAY[@]}" | tar -x -C "$WT"
    git add -f -- "${HEAD_OVERLAY[@]}"
fi
TREE="$(git write-tree)"

cd "$ROOT"
if [ "$TREE" = "$(git rev-parse 'HEAD^{tree}')" ]; then
    echo "没有变化，无需提交。"
    exit 0
fi

COMMIT="$(git commit-tree "$TREE" -p HEAD -m "build: 重新构建插件（底稿 ${BASE_SHA:0:7}）")"
git merge --ff-only --quiet "$COMMIT"
echo "已生成提交：$(git log --oneline -1)，确认后 git push"
