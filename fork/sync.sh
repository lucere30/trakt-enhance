#!/usr/bin/env bash
# 跟随上游同步：以上游最新代码为底，重放 fork/patches 里的定制补丁，
# 改写仓库链接，重新构建并跑测试；全部通过后只保留 Loon 插件需要的文件
# （见 fork/fork.config.json 的 keep），在当前分支上生成一个新提交。
#
# 用法（在仓库根目录）：bash fork/sync.sh
# 结果：
#   - 有更新：当前分支前进一个提交，输出 changed=true
#   - 无更新：什么都不改，输出 changed=false
#   - 补丁冲突/构建或测试失败：非零退出，当前分支不变，原因写入 $SYNC_REPORT（默认 $RUNNER_TEMP/fork-sync-report.md）
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
REPORT="${SYNC_REPORT:-${RUNNER_TEMP:-/tmp}/fork-sync-report.md}"
: > "$REPORT"

cfg() { node -p "require('./fork/fork.config.json').$1"; }
UPSTREAM_URL="$(cfg upstreamUrl)"
UPSTREAM_BRANCH="$(cfg upstreamBranch)"

out() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi; echo "$1"; }

git fetch --no-tags --quiet "$UPSTREAM_URL" "$UPSTREAM_BRANCH"
UP_SHA="$(git rev-parse FETCH_HEAD)"
out "upstream_sha=$UP_SHA"
echo "上游 $UPSTREAM_BRANCH 最新提交：$UP_SHA"

# 本仓库自己维护的文件（README、fork/、.github/）和要从构建结果里保留的文件
mapfile -t OVERLAY_PATHS < <(node -p "require('./fork/fork.config.json').overlay.join('\n')")
mapfile -t KEEP_PATHS < <(node -p "require('./fork/fork.config.json').keep.join('\n')")
# 定制补丁自带的测试文件（上游 npm test 不会跑它们）
mapfile -t EXTRA_TESTS < <(node -p "(require('./fork/fork.config.json').extraTests || []).join('\n')" | sed '/^$/d')

# 输入指纹 = 上游提交 + 本仓库自己维护的内容。
# 构建产物里带生成时间，每次构建都不同，所以用指纹判断是否需要重新同步。
STATE_FILE=fork/sync-state
OVERLAY="$(git ls-tree -r HEAD -- "${OVERLAY_PATHS[@]}" | grep -v "	$STATE_FILE\$" | git hash-object --stdin)"
WANT="upstream=$UP_SHA overlay=$OVERLAY"
PREV_UP="$(sed -n 's/^upstream=\([0-9a-f]*\).*/\1/p' "$STATE_FILE" 2>/dev/null || true)"
if [ "$(cat "$STATE_FILE" 2>/dev/null || true)" = "$WANT" ] && [ "${FORCE_SYNC:-0}" != "1" ]; then
    echo "上游和定制内容都没有变化，跳过。"
    out "changed=false"
    exit 0
fi

WT="$(mktemp -d)"
LOG="$(mktemp -d)"
cleanup() { cd "$ROOT"; git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; git worktree prune; rm -rf "$LOG"; }
trap cleanup EXIT
git worktree add --quiet --detach "$WT" "$UP_SHA"
cd "$WT"

# 上游自己的 .github 不带进来（本仓库只保留自己的工作流）
git rm -r -q --cached --ignore-unmatch .github
rm -rf .github

# 1) 重放定制补丁（3-way 合并，能自动合的就自动合）
shopt -s nullglob
for p in "$ROOT"/fork/patches/*.patch; do
    echo "应用补丁：$(basename "$p")"
    if ! git apply --3way --index --whitespace=nowarn "$p" 2> "$LOG/apply.log"; then
        cat "$LOG/apply.log"
        {
            echo "## 上游同步失败：定制补丁与上游改动冲突"
            echo
            echo "- 上游提交：\`$UP_SHA\`"
            echo "- 冲突补丁：\`fork/patches/$(basename "$p")\`"
            echo "- 冲突文件："
            git diff --name-only --diff-filter=U | sed 's/^/  - `/; s/$/`/'
            echo
            echo '```'
            tail -n 40 "$LOG/apply.log"
            echo '```'
            echo
            echo "main 分支未改动。需要手动更新这个补丁，步骤见 fork/README.md。"
        } >> "$REPORT"
        exit 1
    fi
done

# 2) 仓库链接改为指向本仓库
node "$ROOT/fork/localize.mjs"

# 3) 重新生成构建产物并跑测试
if ! { npm ci --no-audit --no-fund && npm test && { [ "${#EXTRA_TESTS[@]}" -eq 0 ] || node --test "${EXTRA_TESTS[@]}"; }; } > "$LOG/build.log" 2>&1; then
    tail -n 80 "$LOG/build.log"
    {
        echo "## 上游同步失败：构建或测试未通过"
        echo
        echo "- 上游提交：\`$UP_SHA\`"
        echo
        echo '```'
        tail -n 60 "$LOG/build.log"
        echo '```'
        echo
        echo "main 分支未改动。"
    } >> "$REPORT"
    exit 1
fi
tail -n 12 "$LOG/build.log"

# 4) 只保留 Loon 插件需要的文件，再放回本仓库自己维护的文件
git read-tree --empty
for k in "${KEEP_PATHS[@]}"; do
    if [ ! -e "$k" ]; then
        {
            echo "## 上游同步失败：上游找不到需要保留的文件"
            echo
            echo "- 上游提交：\`$UP_SHA\`"
            echo "- 缺失路径：\`$k\`（可能是上游改了目录或文件名，需要更新 fork/fork.config.json 的 keep）"
            echo
            echo "main 分支未改动。"
        } >> "$REPORT"
        echo "缺失：$k"
        exit 1
    fi
    git add -f -- "$k"
done
rm -rf -- "${OVERLAY_PATHS[@]}"
mapfile -t HEAD_OVERLAY < <(git -C "$ROOT" ls-tree --name-only HEAD -- "${OVERLAY_PATHS[@]}")
if [ "${#HEAD_OVERLAY[@]}" -gt 0 ]; then
    git -C "$ROOT" archive HEAD -- "${HEAD_OVERLAY[@]}" | tar -x -C "$WT"
fi
echo "$WANT" > "$STATE_FILE"
git add -f -- "${HEAD_OVERLAY[@]}" "$STATE_FILE"
TREE="$(git write-tree)"

cd "$ROOT"
if [ "$TREE" = "$(git rev-parse 'HEAD^{tree}')" ]; then
    echo "没有变化，无需提交。"
    out "changed=false"
    exit 0
fi

MSG="sync: 跟随上游 ${UP_SHA:0:7}

$(git log --format='- %h %s' -n 20 "${PREV_UP:-$UP_SHA}..$UP_SHA" 2>/dev/null || true)

上游：$UPSTREAM_URL@$UP_SHA"
COMMIT="$(git commit-tree "$TREE" -p HEAD -m "$MSG")"
git merge --ff-only --quiet "$COMMIT"
echo "已生成提交：$(git log --oneline -1)"
out "changed=true"
