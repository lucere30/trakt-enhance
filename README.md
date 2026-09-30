# trakt-enhance

基于 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules) 的 `trakt_simplified_chinese` 定制版，恢复 EplayerX，并增加部分可选功能。

## 特性

- 跟随上游更新（每 12 小时同步）并恢复 EplayerX
- 新增开关：媒体翻译范围（全部 / 仅中文·华语 / 关闭）、历史请求增强、播放器注入总开关
- 保留上游现有功能及各播放器单独选项，默认值与上游行为一致

## 使用

Loon 插件：

```text
https://raw.githubusercontent.com/lucere30/trakt-enhance/main/trakt_simplified_chinese/trakt_simplified_chinese.plugin
```

## 运行时依赖

托管在本仓库：脚本、图标、播放器 Logo（`trakt_simplified_chinese/images/`）。

仍依赖上游作者的服务（本仓库无法镜像）：翻译缓存后端（`backendBaseUrl`，同时用于分发 TMDb API Key）、DeepLX 翻译、DeepLink 跳转域名。

## 仓库结构

```text
.github/workflows/sync-upstream.yml   仅编排；逻辑都在 scripts/
scripts/
  restore-eplayerx.sh                 在上游最新源码上恢复 EplayerX
  apply-customizations.py             新增开关（manifest / argument / 请求 / 播放器）
  install-translation-policy.py       翻译范围策略（独立模块，见 DESIGN_PLAN.md）
  validate-source.py                  构建前校验，含策略行为自测
  publish.py                          改写上游 URL、镜像资源、断言产物
trakt_simplified_chinese/             生成产物（勿手改）
```

## 本地复现

```bash
git clone https://github.com/DemoJameson/Proxy.Modules.git upstream
scripts/restore-eplayerx.sh
python3 scripts/apply-customizations.py
python3 scripts/install-translation-policy.py
python3 scripts/validate-source.py
(cd upstream && npm ci && npm run build:trakt)
python3 scripts/publish.py
```
