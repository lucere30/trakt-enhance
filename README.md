# trakt-enhance

基于 [DemoJameson/Proxy.Modules](https://github.com/DemoJameson/Proxy.Modules) 的 `trakt_simplified_chinese` 修改版。

## 特性

- 跟随上游 `trakt_simplified_chinese` 更新
- 自动恢复 EplayerX 跳转支持
- 保留上游现有功能和播放器选项
- GitHub Actions 自动构建并提交更新后的 `.plugin` / `.js`

## 使用

Loon 插件：

`https://raw.githubusercontent.com/lucere30/trakt-enhance/main/trakt_simplified_chinese/trakt_simplified_chinese.plugin`

## 同步策略

GitHub Actions 每 6 小时检查一次上游，也支持手动运行。构建时只重建上游的源码层：以 EplayerX 被移除前的源码为基础，再应用该提交之后的源码变化；上游的构建系统和依赖始终保持当前版本。这样可以避免用脆弱的文本替换或整仓库回滚覆盖上游的新功能。
