# 定制与上游同步

本仓库只发布 Loon 版「Trakt 增强」插件，脚本来自 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules) 2026-10-28 的版本 `c652548`（MIT 许可）。

## 为什么停在 MIT 版本

2026-10-30 上游改用「Proxy.Modules Source-Available License 1.0」，并改写了全部提交历史（在 9 月插入「chore: 修改协议」后重排了之后的提交）。新许可只适用于 10-30 及以后发布的版本，之前的版本仍是 MIT；它不允许 EplayerX 的作者和用户使用这些脚本，而本仓库的第一项定制就是复原 EplayerX 跳转按钮。

所以本仓库固定在最后一个 MIT 版本 `c652548`（fix(trakt): 兼容 following activities 的 /v3 前缀路由），不再跟随上游：

- 这份上游代码保存在本仓库的 `upstream-mit` 分支，同步从这里取，不依赖上游仓库是否还在、历史是否再被改写。
- `fork.config.json` 的 `requiredLicense` 要求底稿 `LICENSE` 第一行是 `MIT License`，否则 `sync.sh` 拒绝构建。以后即使误把底稿换成新许可的版本，也不会发布出去。
- 上游 10-30 之后的修复（官方 App Universal Link 授权回调、EplayerX 授权例外等）和依赖更新不会进来。

## 仓库里有什么

| 路径 | 说明 |
| --- | --- |
| `trakt_simplified_chinese/trakt_simplified_chinese.plugin` | Loon 插件（自动生成） |
| `trakt_simplified_chinese/trakt_simplified_chinese.js` | 插件加载的脚本（自动生成） |
| `trakt_simplified_chinese/images/` | 图标与播放器 logo（来自上游） |
| `LICENSE` | `c652548` 的 MIT 许可证，按许可要求保留 |
| `README.md`、`fork/`、`.github/` | 本仓库自己维护的说明、定制和同步工作流 |

其余上游文件（源码、测试、Surge/QX 版本、后端等）只在同步构建时临时使用，不提交到本仓库。

## 定制内容

1. **复原 EplayerX 跳转按钮**（`patches/0001-restore-eplayerx.patch`）：撤销上游 `0886a1d`，默认顺序 EplayerX 1 / Forward 2 / Infuse 3 / Rex 4。上游 `ff663ca` 删掉了 EplayerX 图标（`images/eplayerx.webp`、`eplayerx_logo.webp`），这个补丁一并带回。
2. **链接指向本仓库**（`localize.mjs`）：插件里的脚本地址、图标等从 `DemoJameson/Proxy.Modules` 改为 `lucere30/trakt-enhance`。
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

   这个补丁自带的测试列在 `fork.config.json` 的 `extraTests` 里，同步时一起运行。
4. **插件选项显示顺序**（`argument-order.mjs`）：按 `fork.config.json` 的 `argumentOrder` 调整 Loon 插件 `[Argument]` 段的上下顺序（伪装成 VIP → 翻译 → 显示 → 跳转按钮 → 高级）。只改显示顺序，传给脚本的参数顺序不变；上游新增的选项自动排在最后。

## 同步

`.github/workflows/sync-upstream.yml` 每天运行一次（北京时间 08:23；也可在 Actions 页面手动运行），执行 `fork/sync.sh`。底稿固定不变，所以只有本仓库的定制（`fork/`、`README.md`、`.github/`）改动后才会重新构建，其余时候直接跳过：

1. 拉取 `upstream-mit` 分支（上游 `c652548`），确认它的 `LICENSE` 是 MIT；
2. 按顺序重放 `fork/patches/*.patch`（3-way 合并）；
3. 运行 `localize.mjs` 改写链接；
4. `npm ci && npm test`，其中会重新生成插件和脚本；
5. 运行 `extraTests` 列出的补丁自带测试，然后用 `argument-order.mjs` 调整插件选项的显示顺序；
6. 只挑出 `fork.config.json` 里 `keep` 列出的文件，连同 `overlay` 列出的本仓库文件，在 `main` 上追加一个 `sync:` 提交并推送。

任何一步失败，`main` 保持不变，并自动开一个标题为「上游同步失败，需要处理」的 issue。

公开仓库 60 天没有活动时 GitHub 会自动停用定时任务。为防止长期没有新提交导致同步停掉，定时运行时会调用一次“启用工作流”接口，并在最近一次提交超过 45 天时推一个空的 `chore: 保活` 提交。如果仍被停用，到 Actions 页面点 “Enable workflow” 即可恢复。

`fork/sync-state` 记录当前对应的上游提交和本仓库文件指纹，两者都没变时直接跳过（生成的脚本带构建时间，不能用产物是否变化来判断）。本地强制重建：`FORCE_SYNC=1 bash fork/sync.sh`。

## 修改定制

补丁都基于 `upstream-mit`。改完补丁推送到 `main` 后，在 Actions 页面手动运行一次「跟随上游同步」（或等第二天的定时运行）。以 0001 为例（0002 同理，有多个补丁时按编号依次打上，只重新导出改动的那个）：

```bash
git clone https://github.com/lucere30/trakt-enhance.git && cd trakt-enhance
git switch --detach origin/upstream-mit
git apply --3way fork/patches/0001-restore-eplayerx.patch
# 修改源码……
npm ci && npm test                # 确认通过
git add -A && git commit -m "restore eplayerx"
# 只导出源码改动（不含构建产物）作为新补丁：
git format-patch -1 --stdout -- . \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.js' \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.plugin' \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.sgmodule' \
  ':(exclude)trakt_simplified_chinese/trakt_simplified_chinese.snippet' \
  ':(exclude)boxjs.json' > /tmp/new.patch
git switch main
cp /tmp/new.patch fork/patches/0001-restore-eplayerx.patch
git commit -am "fork: 更新 EplayerX 补丁" && git push
```

补丁只改会进入插件的源码和测试；上游的 `README.md` 不发布，不用改。`public/index.html` 也不发布，但上游测试要求它的模块描述和插件描述一致，所以描述改了要一起改。

## 翻译缓存后端

插件默认使用本仓库自己部署的后端 `https://trakt-enhance-backend.vercel.app`（Vercel 项目 `trakt-enhance-backend`，代码就是 `upstream-mit` 分支，缓存存在 Upstash Redis，TMDb key 由后端下发），不再依赖上游作者的 `proxy-modules.demojameson.de5.net`。

- 换地址：改 `fork.config.json` 的 `backendHost.fork`。`localize.mjs` 会把源码、测试、插件重写规则和 MITM 主机名里的上游后端一起换掉，然后正常同步即可。
- 重新部署后端（例如换了 Upstash 或 TMDb key）：在 `upstream-mit` 的检出目录里运行 `npx vercel deploy --prod`，环境变量在 Vercel 项目设置里改。部署说明见 `upstream-mit` 分支的 `DEPLOY_VERCEL.md`。
- 后端只接受 User-Agent 含 `TraktSimplifiedChinese/<版本>` 的请求（插件会自动带上），其他请求返回 403。
- Vercel 项目必须关闭「Deployment Protection → Vercel Authentication」，否则插件拿到的是 Vercel 登录页。
- 在本地跑测试时不要设置 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`：上游有几个后端测试检查「未配置 KV 时返回 500」，设置了会失败。

仍然依赖上游作者的只有 DeepLX 翻译（`deeplx.demojameson.de5.net`），而且只在「翻译引擎」选 DeepLX 时使用，默认是谷歌翻译。
