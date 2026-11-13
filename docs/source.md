# 原包与迁移记录

2026-09-22 首次整理仓库时记录的上游原始归档基线：

- 平台：Linux x64；归档顶层目录：`Antigravity-x64/`
- ASAR 中的应用版本：`2.15.1`
- tar SHA-256：`6f6b578245008217dab861c314e6a5665eaeeea3348d86697c41c1d87ed8e8ff`
- 原始 `app.asar` SHA-256：`0f81685e9836ddf5a382869bea348385650cfe1bfeecbd2e2d902a571ce57261`

以上哈希仅记录当时本地保存的 `2.15.1` 归档，不代表在线验证过下载来源。目前各补丁契约与打包配置已升级至 `2.31.2`（见根目录 [README.md](../README.md) 与 [antigravity.spec](../packaging/antigravity.spec)）。构建器不会自动下载或更新上游 tar，而是在构建时直接校验输入 ASAR 的版本与目标模块哈希。

仓库结构沿革：

- 当前 Agent 版本的构建入口统一为仓库根目录的 [build.sh](../build.sh)，桌面启动项位于 [packaging/antigravity.desktop](../packaging/antigravity.desktop)。
- 窗口控制修复代码与测试位于 [tools/window-controls/](../tools/window-controls/)。
- 早期 Antigravity IDE 2.0.4 的 spec、桌面启动项及旧脚本已归档至 [legacy/antigravity-ide/](../legacy/antigravity-ide/)，不参与当前构建。
