# Trakt 增强

让 Trakt App 显示简体中文标题、简介和海报，并在影片详情页添加 EplayerX、Forward、Infuse、Rex 跳转按钮。

## 安装

添加插件：

```
https://raw.githubusercontent.com/lucere30/trakt-enhance/main/trakt_simplified_chinese/trakt_simplified_chinese.plugin
```

## 来源与更新

脚本来自 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules)（MIT 许可，见 `LICENSE`），本仓库做了以下改动：

- 复原了上游移除的 EplayerX 跳转按钮
- 插件里的脚本和图标地址改为指向本仓库
- 新增开关「只翻译中文影视」（默认开启）：只翻译原始语言为中文的剧集和电影，其他语言的标题、简介、集数、评论、演职员等保留 Trakt 原文；海报对所有影视按「海报语言」处理
- 新增开关「人物页翻译」（默认开启）：控制上述模式下人物页是否翻译
- 插件选项按用途重新排列显示顺序（伪装成 VIP → 翻译 → 显示 → 跳转按钮 → 高级）

仓库只保留 Loon 插件运行需要的文件。GitHub Actions 每 12 小时自动拉取上游、重新构建并更新这些文件，详见 [`fork/README.md`](fork/README.md)。
