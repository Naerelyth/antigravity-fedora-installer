# 独立外观补丁

构建顺序：原始 tar → `window-controls` → `settings-shadow` / `startup-appearance` → RPM。

两个外观补丁相互独立，不混入 `window-controls` 的 payload 或替换规则；两者修改的文件互不重叠，可单独选择或交换应用顺序，但输入包必须先经过当前 `window-controls` 补丁处理。

`archive.js` 统一提供 ASAR 读取、头部编码、追加替换与分块完整性计算，供窗口重构器和外观补丁应用器共用。具体替换规则、输出保护与最终校验仍由各自入口负责；窗口重构器会复用已校验的变换结果，不在写入时重复执行变换。当前代码契约基线为 Antigravity 2.31.2。

| 补丁 | 修改内容 | ASAR 文件 |
| --- | --- | --- |
| `settings-shadow` | 移除设置面板 `.settings-modal-container` 的 `box-shadow`，保留遮罩、圆角与边框 | `dist/preload.js` |
| `startup-appearance` | 读取本机启动亮／暗主题种子；统一内容层圆角、同步加载页尺寸与主题交接 | `dist/utils.js`、`dist/loadingOverlay.js`、新增 `dist/startupAppearance.js` |

主要行为与实现细节：

- **启动主题与系统跟随**：沿用上游 `getThemeMode()`，继承系统模式时也会选取对应的亮／暗种子。自定义背景色与前景色仅接受 `#RRGGBB` 格式的六位十六进制值，缺失或无效时回退为默认配色；配置在每次运行时从本机读取。加载视图存活期间监听 `nativeTheme.updated`：仅当配置为跟随系统（`themeMode` 包含 `INHERIT`）时重新读取种子，并同步更新原生视图背景、加载页背景、Logo 颜色及按钮符号色；若加载页尚未完成导航，先暂存最新配色并在 `did-finish-load` 后应用，视图释放时移除监听。
- **多视图结构与圆角**：主窗口采用 `BaseWindow`，由持久背景层 `curtainView`、透明 Hub 内容视图和临时加载视图分别负责背景绘制、应用页面与启动 Logo 显示，同时保留上游持久背景层及其颜色缓存机制。三层视图统一设置 8 DIP 原生圆角以匹配当前 Linux 主窗口轮廓，最大化或全屏时为 0；`curtainView` 与 Hub 视图的圆角监听会保留到窗口关闭，交接后仍随窗口状态更新。
- **加载页布局对齐**：加载视图以 `win.contentView.getBounds()` 为尺寸来源，并监听 `win.contentView` 的 `bounds-changed` 事件。在 Wayland 下，窗口的 `resize` 事件可能早于原生内容布局完成并读到旧尺寸，若仅监听 `resize`，加载页在分数缩放或桌面重新配置窗口时会与实际窗口尺寸脱节，表现为 Logo 偏移。该修复保留原有的 Flex 居中布局与 SVG，不按分辨率添加偏移，也不额外乘以设备缩放系数。
- **主题就绪交接与清理**：主题配色在窗口创建前即完成计算，用于启动加载页与初始按钮符号色（按钮背景保持透明）。Hub 内容触发 `did-finish-load` 后，通过 `getHubWebContents(win)` 等待主页面出现 `[data-testid="title-menu-bar"]` 且 `body` 背景色连续两个动画帧匹配当前目标主题，再调用上游 `cleanupOverlay()`。等待期间临时禁用主页面后台节流，结束后恢复原值；若等待途中目标主题发生变化，则按新目标重新核对，总等待上限为 10 秒。超时或执行异常时记录警告并释放加载视图，避免永久遮挡应用。
- **释放幂等与关闭保护**：`cleanupOverlay()` 保留上游的幂等检查与窗口关闭保护，并释放加载视图的 `WebContents` 与外观监听器。加载内容由保存了引用的幂等清理函数统一关闭，避免销毁后读取已清空的 `view.webContents`。窗口关闭时会取消尚未触发的监听；已开始的主题等待即使随后结束，也不会重复清理视图。

> 注：前端页面当前使用 `--background` 绘制 `body` 并保留 `title-menu-bar` 标记；设置面板在普通窗口下仍使用 `shadow-2xl`，由独立的 `settings-shadow` 补丁覆盖其阴影。

命令行用法（输入需为已完成 `window-controls` 处理的中间 ASAR，输出必须为新路径）：

```bash
node tools/asar-patches/apply.js /tmp/window.asar /tmp/complete.asar
node tools/asar-patches/apply.js /tmp/window.asar /tmp/shadow-only.asar settings-shadow
node tools/asar-patches/apply.js /tmp/window.asar /tmp/startup-only.asar startup-appearance
```

输入／输出代码与本地 payload 均锁定 SHA-256，遇到未知漂移立即失败，不提供跳过校验的选项。重复应用自身补丁可保持逐字节幂等。已应用外观补丁的合并产物不能再交给单独的 `window-controls` 重构器处理，重新构建应始终从官方原始 tar 开始。`bash build.sh` 默认依次应用全部补丁，输出 `appearance-patches.json` 记录两个独立补丁的改动，最终产物统一命名为 `app.asar`（`window-controls.asar` 仅作中间文件）。

默认测试覆盖独立应用、组合应用、漂移拒绝、源文件保护、幂等性、内容布局同步以及延迟主题清理；`npm run test:browser` 在真实浏览器中验证 DOM/CSS 行为。

`test/appearance-electron.cjs` 为独立的 Electron GUI 回归入口，要求设置 `APPEARANCE_TEST_ASAR`（组合产物 `app.asar` 的绝对路径）与 `APPEARANCE_TEST_PROFILE`（临时配置目录）。该脚本基于 `BaseWindow` 与 Hub `WebContentsView` 测试原生 API、补丁加载与生命周期，隔离了完整应用的服务依赖，因此不替代完整业务界面的视觉验收。测试覆盖 4:3 初始窗口、尺寸调整、页面 133% 缩放与最大化／还原时的 Logo 居中及内容视图尺寸，以及启动期间连续亮暗切换后的背景、按钮配色与主题交接；另可向隔离的 Electron 进程传入 `--force-device-scale-factor=1.33` 验证分数设备缩放（注意区分设备缩放与页面缩放）。
