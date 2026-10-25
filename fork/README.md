# 定制与上游同步

本分支（`snow-base`）只发布 Loon 版「Trakt 增强」插件，以 [liixing/Proxy.Modules](https://github.com/liixing/Proxy.Modules)（snow 维护，基于 DemoJameson/Proxy.Modules，MIT 许可）为上游。

## 仓库里有什么

| 路径 | 说明 |
| --- | --- |
| `trakt_simplified_chinese/trakt_simplified_chinese.plugin` | Loon 插件（自动生成） |
| `trakt_simplified_chinese/trakt_simplified_chinese.js` | 插件加载的脚本（自动生成） |
| `trakt_simplified_chinese/images/` | 图标与播放器 logo（来自上游） |
| `trakt_simplified_chinese/*_clear_cache.js`、`*_expand_cache.js` | 插件引用的定时任务脚本（默认关闭）：手动清理本地缓存、缓存压力测试。上游有才保留（`keepIfExists`） |
| `LICENSE` | 上游 MIT 许可证，按许可要求保留 |
| `README.md`、`fork/`、`.github/` | 本仓库自己维护的说明、定制和同步工作流 |

其余上游文件（源码、测试、Surge/QX 版本、后端等）只在同步构建时临时使用，不提交到本仓库。

## 定制内容

1. **EplayerX 跳转按钮**：上游（snow 版本）本来就保留了 EplayerX，本分支不需要额外补丁。
2. **链接指向本仓库**（`localize.mjs`）：插件里的脚本地址、图标等从 `liixing/Proxy.Modules` 改为 `lucere30/trakt-enhance`。
3. **只翻译中文影视、中文原海报**（`patches/0002-chinese-only.patch`）：新增四个插件选项。
   - 「只翻译中文影视」（默认开启）：原始语言为中文的剧集和电影照常翻译；其他语言的文字保留 Trakt 原文（标题、简介、集数标题、预告片、评论、口碑摘要、演职员表，以及 App 自己请求的中文译名）。海报不受这个开关影响。片单名称和描述不处理。播放器跳转按钮、VIP、历史合并不受影响。
   - 「人物页翻译」（默认开启）：人物详情页是否翻译演员名和简介。和下一项一样单独生效，不受「只翻译中文影视」影响。
   - 「人物搜索翻译」（默认全部翻译）：人物搜索结果和本月生日人物列表翻译谁的名字和简介，与「人物页翻译」互不影响；影视页里的演职员表仍按该影视的语言决定。
     - 全部翻译：和上游一致。
     - 华人和日韩名：TMDb 中文名不带间隔号的人（周星驰、木村拓哉、宋康昊）；带间隔号的音译名（汤姆·汉克斯）或没有中文名的人保留原文，名字不调用机器翻译。
     - 仅华人名：在上一档基础上排除 TMDb 出生地在日本、韩国的人；出生地缺失或在其他地方（包括海外出生的华裔，如吴彦祖）按华人处理。
     - 关闭：原样放行。

     中文名先取本地缓存和翻译缓存后端，都没有时补查 TMDb 人物详情（每页最多 20 人），结果写回人物缓存；出生地判定记在 `dj_trakt_fork_person_region`（最多 3000 条），同一个人只查一次。

   另外，插件自己向 Trakt 发的详情请求（补查语言、ID、原标题）带 `x-script-trakt-detail-request` 请求头；如果 Loon 把这些请求也交给插件处理，插件看到这个头会原样放行，不会再翻译、换海报。

   开关用到的本地记录：影视语言（`dj_trakt_fork_media_language`）和不翻译的评论（`dj_trakt_fork_comment_scope`）分开存放，各最多 3000 条，满了淘汰最早写入的。补查到的详情里没有语言时，记一个 7 天的「未知」标记（照常翻译），期间不再补查；请求失败不记。

   这些记录和下面的出生地记录共用 `shared/fork-store.mjs`；「调试模式」选了禁用本地缓存或禁用所有缓存时，既不读也不写。
   - 「中文影视用中文原海报」（默认开启）：原始语言为中文的剧集和电影固定按“原片语言”取 TMDb 中文海报（优先原产地区版本，如台剧用台版、港片用港版；没有中文海报时保留 Trakt 原图），不受「海报语言」影响；「海报语言」只管其他语言的影视。「海报语言」选原图时，非中文影视完全不请求海报。粤语片（语言代码 `cn`）同时接受标为 `zh` 的中文海报。

   这个补丁和 `main` 分支的同名补丁功能相同，按本分支上游做了少量适配：`utils/cache.mjs` 导出 `isLocalCacheDisabled`（snow 版本没有导出）；补丁自带测试使用脚本内置的 TMDb key；测试工具记录 GET 请求头。

   这个补丁自带的测试列在 `fork.config.json` 的 `extraTests` 里，同步时一起运行。
4. **插件选项显示顺序**（`argument-order.mjs`）：按 `fork.config.json` 的 `argumentOrder` 调整 Loon 插件 `[Argument]` 段的上下顺序（翻译 → 显示 → 跳转按钮 → 高级；列表里有而上游没有的选项，如 Forward、Rex，会自动跳过）。只改显示顺序，传给脚本的参数顺序不变；上游新增的选项自动排在最后。

## 同步

GitHub 只运行默认分支（`main`）上的定时任务，所以本分支不会自动同步：需要在 Actions 页面选「跟随上游同步」→ Run workflow，分支选 `snow-base`。它会执行 `fork/sync.sh`：

1. 拉取上游 `main` 的完整代码；
2. 按顺序重放 `fork/patches/*.patch`（3-way 合并）；
3. 运行 `localize.mjs` 改写链接；
4. `npm ci && npm test`，其中会重新生成插件和脚本；
5. 运行 `extraTests` 列出的补丁自带测试，然后用 `argument-order.mjs` 调整插件选项的显示顺序；
6. 只挑出 `fork.config.json` 里 `keep` 列出的文件，连同 `overlay` 列出的本仓库文件，在 `snow-base` 上追加一个 `sync:` 提交并推送。

任何一步失败，`snow-base` 保持不变，并自动开一个标题为「上游同步失败，需要处理」的 issue。

`fork/sync-state` 记录当前对应的上游提交和本仓库文件指纹，两者都没变时直接跳过（生成的脚本带构建时间，不能用产物是否变化来判断）。本地强制重建：`FORCE_SYNC=1 bash fork/sync.sh`。

## 补丁冲突时如何更新

上游改动了补丁涉及的代码时会冲突，需要手动合并后更新补丁（本分支目前只有 0002；有多个补丁时按编号依次打上，只重新导出冲突的那个）：

```bash
git clone https://github.com/lucere30/trakt-enhance.git && cd trakt-enhance
cp fork/patches/0002-chinese-only.patch /tmp/old.patch
git fetch https://github.com/liixing/Proxy.Modules.git main
git switch --detach FETCH_HEAD
git apply --3way /tmp/old.patch   # 冲突处 ours=上游、theirs=本仓库定制，合并后 git add
npm ci && npm test                # 确认通过
git add -A && git commit -m "restore eplayerx"
# 只导出源码改动（不含构建产物）作为新补丁：
git format-patch -1 --stdout -- . \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese*.js' \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.plugin' \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.sgmodule' \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.snippet' \
  ':(exclude)boxjs.json' > /tmp/new.patch
git switch main
cp /tmp/new.patch fork/patches/0002-chinese-only.patch
git commit -am "fork: 更新补丁" && git push
```

推送后在 Actions 页面手动运行一次「跟随上游同步」。

## 仍然依赖的在线服务

以下服务本仓库没有替换：

- `traktmodule.eplayerx.com`：snow 部署的翻译缓存与跳转接口（Cloudflare Workers）
- `api.deeplx.org`：公共 DeepLX 翻译
- TMDb 密钥写死在脚本里（snow 版本未跟进原项目“由后端下发密钥”的改动）
