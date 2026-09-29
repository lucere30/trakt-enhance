# trakt-enhance

基于 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules) 的 `trakt_simplified_chinese` 定制版。

本仓库的目标是：**跟随上游更新，同时保留 EplayerX，并增加可独立控制的功能选项。**

## 使用

Loon 插件：

```text
https://raw.githubusercontent.com/lucere30/trakt-enhance/main/trakt_simplified_chinese/trakt_simplified_chinese.plugin
```

## 当前特性

- 跟随上游 `trakt_simplified_chinese` 源码和构建系统更新
- 自动恢复 EplayerX 跳转支持
- 保留上游现有功能及播放器选项
- EplayerX / Forward / Infuse / Rex 可分别控制
- 增加「播放器注入」总开关
- 增加「历史请求增强」独立开关
- 「历史剧集按电视剧合并」与「历史请求增强」相互独立
- 翻译引擎支持 Google / DeepLX / 关闭
- 增加「媒体翻译范围」：全部作品 / 仅中文·华语作品 / 关闭媒体翻译
- 「仅中文·华语作品」根据 Trakt 媒体的 `language` / `country` 判断，不通过标题中是否存在中文字符判断
- 中文/华语作品可翻译为简体中文，英语、日语、韩语等其他作品可以保持 Trakt 原始英文
- `trakt.webp`、`.js` 和 `.plugin` 的运行时资源均镜像到本仓库，不依赖上游仓库提供运行时资源

## 功能开关逻辑

### 翻译

「翻译部分文本」用于选择翻译引擎：

- 谷歌翻译
- DeepLX
- 关闭

「媒体翻译范围」进一步控制哪些作品进入媒体翻译流程：

- **全部作品**：按照当前插件的正常翻译逻辑处理
- **仅中文/华语作品**：仅对 `language = zh` 或国家/地区为 `CN / HK / TW / SG / MO` 的作品进行媒体翻译；其他作品保留原始文本
- **关闭媒体翻译**：不进行媒体标题、简介等媒体翻译

角色名翻译仍由独立的「用豆瓣翻译角色名」开关控制。

### 历史记录

- **历史请求增强**：控制 History Episodes 请求的 `limit` 是否提高，以减少分页请求
- **历史剧集按电视剧合并**：控制获取到的历史记录是否按电视剧进行整理合并

两个功能相互独立：关闭历史请求增强不会强制关闭历史记录合并。

### 播放器

「播放器注入」是播放器功能总开关。开启后，再由 EplayerX、Forward、Infuse、Rex 各自的配置决定是否注入及排序；关闭总开关后，不再执行播放器来源/Watch Now 等注入逻辑。

## 上游同步

GitHub Actions **每 12 小时检查一次上游**，同时支持手动运行。

同步流程为：

```text
DemoJameson/Proxy.Modules
        ↓
获取最新上游源码
        ↓
恢复 EplayerX
        ↓
应用本仓库定制补丁
        ↓
npm ci + 上游构建系统
        ↓
功能与资源完整性检查
        ↓
发布 .plugin / .js / trakt.webp
```

### 后续上游更新的兼容方式

本仓库不是简单复制某一个旧版本文件，而是以**当前上游版本为基础重新构建**。EplayerX 恢复和其他定制功能由 `scripts/apply-customizations.py` 在每次同步时重新应用。

因此，只要上游继续保持当前的目录结构、构建方式以及相关功能接口，本仓库可以持续跟随后续更新。

同时同步流程采用 **fail-closed** 策略：如果未来上游发生较大的结构变化，使某个补丁找不到对应代码锚点、EplayerX 无法恢复、构建失败或最终插件校验失败，GitHub Actions 会停止并且**不会提交新的坏版本**；仓库继续保留最近一次成功同步的版本。

因此，上游失效或不兼容时不会直接导致你当前已经发布的插件被覆盖。

## 运行时依赖

发布后的 `.plugin` 会引用本仓库自己的：

- `trakt_simplified_chinese.js`
- `images/trakt.webp`
- GitHub 项目主页

因此插件日常运行不依赖 `DemoJameson/Proxy.Modules`。上游仓库只作为**自动同步和更新来源**。

## 目录

```text
trakt-enhance/
├── .github/
│   └── workflows/
│       └── sync-upstream.yml
├── scripts/
│   └── apply-customizations.py
├── trakt_simplified_chinese/
│   ├── trakt_simplified_chinese.plugin
│   ├── trakt_simplified_chinese.js
│   └── images/
│       └── trakt.webp
└── README.md
```
