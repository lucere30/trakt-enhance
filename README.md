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

GitHub Actions 每日检查上游；也支持手动运行。构建时从上游 Git 历史中恢复被移除的 EplayerX 支持，然后重新生成插件产物。
