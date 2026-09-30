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

## 自动同步

`.github/workflows/sync-upstream.yml` 每 6 小时运行一次（也可在 Actions 页面手动运行），执行 `fork/sync.sh`：

1. 拉取上游 `main` 的完整代码；
2. 按顺序重放 `fork/patches/*.patch`（3-way 合并）；
3. 运行 `localize.mjs` 改写链接；
4. `npm ci && npm test`，其中会重新生成插件和脚本；
5. 只挑出 `fork.config.json` 里 `keep` 列出的文件，连同 `overlay` 列出的本仓库文件，在 `main` 上追加一个 `sync:` 提交并推送。

任何一步失败，`main` 保持不变，并自动开一个标题为「上游同步失败，需要处理」的 issue。

`fork/sync-state` 记录当前对应的上游提交和本仓库文件指纹，两者都没变时直接跳过（生成的脚本带构建时间，不能用产物是否变化来判断）。本地强制重建：`FORCE_SYNC=1 bash fork/sync.sh`。

## 补丁冲突时如何更新

上游改动了补丁涉及的代码时会冲突，需要手动合并后更新补丁：

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
