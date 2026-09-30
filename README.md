# Trakt 增强

让 Trakt App 显示简体中文标题、简介和海报，并在影片详情页添加 EplayerX、Infuse 跳转按钮。

## 安装

添加插件：

```
https://raw.githubusercontent.com/lucere30/trakt-enhance/snow-base/trakt_simplified_chinese/trakt_simplified_chinese.plugin
```

## 来源与更新

> 这是 `snow-base` 测试分支：以 [liixing/Proxy.Modules](https://github.com/liixing/Proxy.Modules)（snow 维护，基于 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules)，MIT 许可，见 `LICENSE`）为基础。

沿用 snow 版本的内容：跳转按钮只有 EplayerX 和 Infuse；翻译缓存和跳转接口使用 `traktmodule.eplayerx.com`；详情页并行请求；DeepLX 使用 `api.deeplx.org`。

本仓库在其基础上做了以下改动：

- 插件里的脚本和图标地址改为指向本仓库
- 新增开关「仅处理中文原片」（默认开启）：只处理原始语言为中文的剧集和电影，其他语言的标题、简介、海报等保留 Trakt 原样
- 新增开关「人物页翻译」（默认开启）：控制上述模式下人物页是否翻译
- 插件选项按用途重新排列显示顺序（翻译 → 显示 → 跳转按钮 → 高级）

仓库只保留 Loon 插件运行需要的文件。GitHub Actions 每 12 小时自动拉取上游（liixing/Proxy.Modules）、重新构建并更新这些文件，详见 [`fork/README.md`](fork/README.md)。
