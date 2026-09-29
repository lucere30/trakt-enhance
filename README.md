# trakt-enhance

基于 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules) 的 `trakt_simplified_chinese` 定制版，恢复 EplayerX，并增加部分可选功能。

## 特性

- 跟随上游更新并恢复 EplayerX
- 支持翻译范围、历史请求增强、播放器注入等开关
- 保留上游现有功能及播放器选项
- 插件运行时资源使用本仓库

## 使用

Loon 插件：

```text
https://raw.githubusercontent.com/lucere30/trakt-enhance/main/trakt_simplified_chinese/trakt_simplified_chinese.plugin
```

## 更新

GitHub Actions 每 12 小时检查一次上游，也支持手动运行。同步时以最新上游版本为基础重新应用本仓库的定制修改；如果构建或检查失败，则不会发布新版本。