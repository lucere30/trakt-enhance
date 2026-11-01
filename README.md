# Trakt 增强

让 Trakt App 显示简体中文标题、简介和海报，并在影片详情页添加 EplayerX、Forward、Infuse、Rex 跳转按钮。

## 安装

添加插件：

```
https://raw.githubusercontent.com/lucere30/trakt-enhance/main/trakt_simplified_chinese/trakt_simplified_chinese.plugin
```

## 来源与更新

脚本来自 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules) 2026-10-28 的版本 `c652548`（MIT 许可，见 `LICENSE`），本仓库做了以下改动：

- 复原了上游移除的 EplayerX 跳转按钮
- 插件里的脚本和图标地址改为指向本仓库
- 新增开关「只翻译中文影视」（默认开启）：只翻译原始语言为中文的剧集和电影，其他语言的标题、简介、集数、评论、演职员等保留 Trakt 原文；海报不受影响
- 新增开关「中文影视用中文原海报」（默认开启）：中文剧集和电影固定用 TMDb 中文海报（优先原产地区版本，如台剧用台版），其他影视按「海报语言」
- 新增开关「人物页翻译」（默认开启）：人物详情页是否翻译
- 新增选项「人物搜索翻译」（默认全部翻译）：人物搜索（含本月生日人物列表）翻译谁——全部翻译 / 华人和日韩名 / 仅华人名 / 关闭
- 以上两项单独生效，不受「只翻译中文影视」影响

上游从 2026-10-30 起改用限制 EplayerX 作者和用户的 source-available 许可，所以本仓库停在最后一个 MIT 版本，不再跟随上游更新。GitHub Actions 每天检查一次，只在本仓库的定制改动时重新构建，详见 [`fork/README.md`](fork/README.md)。
