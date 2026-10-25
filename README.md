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
- 新增开关「只翻译中文影视」（默认开启）：只翻译原始语言为中文的剧集和电影，其他语言的标题、简介、集数、评论、演职员等保留 Trakt 原文；海报不受影响
- 新增开关「中文影视用中文原海报」（默认开启）：中文剧集和电影固定用 TMDb 中文海报（优先原产地区版本，如台剧用台版），其他影视按「海报语言」
- 新增开关「人物页翻译」（默认开启）：人物详情页是否翻译
- 新增选项「人物搜索翻译」（默认全部翻译）：人物搜索（含本月生日人物列表）翻译谁——全部翻译 / 华人和日韩名 / 仅华人名 / 关闭
- 以上两项单独生效，不受「只翻译中文影视」影响
- 插件选项按用途重新排列显示顺序（翻译 → 显示 → 跳转按钮 → 高级）

仓库只保留 Loon 插件运行需要的文件。在 GitHub Actions 页面手动运行「跟随上游同步」（分支选 `snow-base`）即可拉取上游（liixing/Proxy.Modules）、重新构建并更新这些文件，详见 [`fork/README.md`](fork/README.md)。
