# 定制与上游同步

本仓库只发布 Loon 版「Trakt 增强」插件，脚本来自 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules)（MIT 许可）。

## 仓库里有什么

| 路径 | 说明 |
| --- | --- |
| `trakt_simplified_chinese/trakt_simplified_chinese.plugin` | Loon 插件（自动生成） |
| `trakt_simplified_chinese/trakt_simplified_chinese.js` | 插件加载的脚本（自动生成） |
| `trakt_simplified_chinese/images/` | 图标与播放器 logo（来自上游） |
| `LICENSE` | 上游 MIT 许可证，按许可要求保留 |
| `README.md`、`fork/`、`.github/` | 本仓库自己维护的说明、定制和同步工作流 |

其余上游文件（源码、测试、Surge/QX 版本、后端等）只在同步构建时临时使用，不提交到本仓库。

## 定制内容

1. **复原 EplayerX 跳转按钮**（`patches/0001-restore-eplayerx.patch`）：撤销上游 `0886a1d`，默认顺序 EplayerX 1 / Forward 2 / Infuse 3 / Rex 4。
2. **链接指向本仓库**（`localize.mjs`）：插件里的脚本地址、图标等从 `DemoJameson/Proxy.Modules` 改为 `lucere30/trakt-enhance`。
3. **只翻译中文影视、中文原海报**（`patches/0002-chinese-only.patch`）：新增四个插件开关。
   - 「只翻译中文影视」（默认开启）：原始语言为中文的剧集和电影照常翻译；其他语言的文字保留 Trakt 原文（标题、简介、集数标题、预告片、评论、口碑摘要、演职员表，以及 App 自己请求的中文译名）。海报不受这个开关影响。片单名称和描述不处理。播放器跳转按钮、VIP、历史合并不受影响。
   - 「人物页翻译」（默认开启）：上面开关开启时，人物详情页是否翻译演员名和简介。
   - 「人物搜索翻译」（默认开启）：上面开关开启时，人物搜索结果和本月生日人物列表是否翻译演员名和简介。与「人物页翻译」互不影响；影视页里的演职员表仍按该影视的语言决定。

   另外，插件自己向 Trakt 发的详情请求（补查语言、ID、原标题）带 `x-script-trakt-detail-request` 请求头；如果 Loon 把这些请求也交给插件处理，插件看到这个头会原样放行，不会再翻译、换海报。

   开关用到的本地记录：影视语言（`dj_trakt_fork_media_language`）和不翻译的评论（`dj_trakt_fork_comment_scope`）分开存放，各最多 3000 条，满了淘汰最早写入的。
   - 「中文影视用中文原海报」（默认开启）：原始语言为中文的剧集和电影固定按“原片语言”取 TMDb 中文海报（优先原产地区版本，如台剧用台版、港片用港版；没有中文海报时保留 Trakt 原图），不受「海报语言」影响；「海报语言」只管其他语言的影视。「海报语言」选原图时，非中文影视完全不请求海报。粤语片（语言代码 `cn`）同时接受标为 `zh` 的中文海报。

   这个补丁自带的测试列在 `fork.config.json` 的 `extraTests` 里，同步时一起运行。
4. **插件选项显示顺序**（`argument-order.mjs`）：按 `fork.config.json` 的 `argumentOrder` 调整 Loon 插件 `[Argument]` 段的上下顺序（伪装成 VIP → 翻译 → 显示 → 跳转按钮 → 高级）。只改显示顺序，传给脚本的参数顺序不变；上游新增的选项自动排在最后。

## 自动同步

`.github/workflows/sync-upstream.yml` 每 12 小时运行一次（也可在 Actions 页面手动运行），执行 `fork/sync.sh`：

1. 拉取上游 `main` 的完整代码；
2. 按顺序重放 `fork/patches/*.patch`（3-way 合并）；
3. 运行 `localize.mjs` 改写链接；
4. `npm ci && npm test`，其中会重新生成插件和脚本；
5. 运行 `extraTests` 列出的补丁自带测试，然后用 `argument-order.mjs` 调整插件选项的显示顺序；
6. 只挑出 `fork.config.json` 里 `keep` 列出的文件，连同 `overlay` 列出的本仓库文件，在 `main` 上追加一个 `sync:` 提交并推送。

任何一步失败，`main` 保持不变，并自动开一个标题为「上游同步失败，需要处理」的 issue。

公开仓库 60 天没有活动时 GitHub 会自动停用定时任务。为防止上游长期不更新导致同步停掉，定时运行时会调用一次“启用工作流”接口，并在最近一次提交超过 45 天时推一个空的 `chore: 保活` 提交。如果仍被停用，到 Actions 页面点 “Enable workflow” 即可恢复。

`fork/sync-state` 记录当前对应的上游提交和本仓库文件指纹，两者都没变时直接跳过（生成的脚本带构建时间，不能用产物是否变化来判断）。本地强制重建：`FORCE_SYNC=1 bash fork/sync.sh`。

## 补丁冲突时如何更新

上游改动了补丁涉及的代码时会冲突，需要手动合并后更新补丁（以 0001 为例，0002 同理；有多个补丁时按编号依次打上，只重新导出冲突的那个）：

```bash
git clone https://github.com/lucere30/trakt-enhance.git && cd trakt-enhance
cp fork/patches/0001-restore-eplayerx.patch /tmp/old.patch
git fetch https://github.com/DemoJameson/Proxy.Modules.git main
git switch --detach FETCH_HEAD
git apply --3way /tmp/old.patch   # 冲突处 ours=上游、theirs=本仓库定制，合并后 git add
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

推送后在 Actions 页面手动运行一次「跟随上游同步」。

## 仍然依赖上游的在线服务

以下是上游作者部署的服务，本仓库没有替换：

- `proxy-modules.demojameson.de5.net`：翻译缓存后端，也负责下发 TMDb key（可在插件参数「翻译缓存接口」里改成自己部署的地址，部署方法见上游 `DEPLOY_VERCEL.md`）
- `deeplx.demojameson.de5.net`：DeepLX 翻译
