# Antigravity 窗口控制按钮组重构

基于 Antigravity 2.31.2 的 ASAR 代码契约，为上游 `BaseWindow` 与 Hub `WebContentsView` 提供独立的 `dist/windowControls.js` 原生窗口按钮控制器。

核心行为：

- overlay 背景始终设为 `#00000000` 透明，使按钮后方直接透出网页标题栏与遮罩，不再独立计算背景 RGB（已在当前 Electron/Linux 桌面下通过渐变与遮罩验证透出效果）。
- 基准高度匹配上游标题栏的 35px，按页面缩放系数（限制在 0.25–5）计算并向下取整，避免按钮下沿溢出。
- 监听 `nativeTheme.updated`，在系统亮暗模式切换后即时刷新；当配置为跟随系统时，清除残留的渲染层颜色并按系统主题回退默认符号色。
- 保留渲染层原有的 `setTitleBarOverlay()` 接口，继续接收应用主题传入的按钮符号颜色。
- IPC 通过上游 `resolveHubWindowFromWebContents(event.sender)` 定位所属窗口，并校验发送方确为该窗口的 Hub 页面。
- 共用 `hubZoom.js` 在菜单、快捷键和 IPC 缩放后刷新按钮高度；窗口初始化恢复持久化缩放级别后同样刷新。
- 窗口关闭时移除 `nativeTheme` 与 `webContents` 上的相关监听器。

控制器在 Hub 内容与窗口别名初始化后安装，并保存 `webContents` 引用用于缩放监听与关闭清理（避免在窗口销毁后访问原生 getter）。窗口背景与内容归属逻辑仍沿用上游实现。

加载页与遮罩同步机制：

- **加载页颜色同步**：按钮区域保持透明以显示下方的加载页背景，按钮符号使用加载页的 `foregroundColor`，正式页面加载完成后交由其主题接管。回归测试会执行变换后的 `createWindow`，检查亮／暗加载页、重复打开与背景透明约束。
- **模态遮罩颜色同步**：在沙箱化的 preload 中保留原主题配色，识别覆盖在标题栏上方且占满全窗口的遮罩，读取其计算后的背景色与透明度，仅合成新的按钮符号色发送给主进程，并在遮罩移除后恢复原符号色（未覆盖标题栏的局部遮罩不影响按钮）。该合成适用于纯色半透明 DOM 遮罩，不模拟 CSS 滤镜；按钮背景不受此限制，直接共享页面实际绘制结果。
- **不覆盖共享背景**：即使上游主题消息携带过期或不透明的背景色，控制器也始终保持 overlay 背景透明；不使用截图采样、Gamma 补偿或独立的背景色缓存。设置面板阴影与启动页外观分别由 `tools/settings-shadow` 和 `tools/startup-appearance` 处理，不包含在本补丁中。
- **遮罩识别与同步时序**：遮罩识别包含 `pointer-events: none` 元素，并按层叠上下文排序；候选元素在 DOM 变化时更新缓存，动画帧（400ms 跟踪窗口内）仅检查候选元素。`setTitleBarOverlay()` 调用前会先通过 `observer.takeRecords()` 收集尚未递送的 DOM 变更，避免同一轮变更读取旧候选；`MutationObserver` 回调会在当前微任务中立即同步颜色，不额外等待下一动画帧。重叠的脏子树只扫描一次，固定十六进制与 RGB/RGBA 颜色使用有界缓存（上限 64 项）。背景由页面统一绘制，原生按钮符号则经 IPC 异步更新，两者不保证严格同帧。

契约校验与版本处理：

- 加载页模块 `dist/loadingOverlay.js` 也纳入完整 SHA-256 契约校验；回归测试会运行它生成的 HTML，检查加载页配色与按钮背景透明约束。
- 在当前 2.31.2 上游基线上支持已知历史 `modalThemeSync` payload 修订的就地升级，其他未知漂移一律拒绝。
- 重构器锁定目标文件与新增模块的完整 SHA-256，只接受已确认的 2.31.2 原始结构或本工具生成的已重构结构。目标代码任意字节漂移、只应用了一半补丁，或通过符号链接／硬链接指回源文件时都会报错中止，不会写出半成品，也不会覆盖源包。
- 应用版本号从 ASAR 元数据自动读取。新版本只要未改变已验证模块的代码即可复用本修复；若发生代码漂移，必须重新分析并更新适配，打包流程不提供跳过校验或绕过补丁的选项。

## 代码契约与模块职责

| ASAR 模块 | 补丁处理 |
| --- | --- |
| `dist/utils.js` | 保留上游 `BaseWindow`、持久背景层、窗口状态恢复和导航保护；在 Hub 内容初始化后安装控制器，并在恢复保存的缩放级别时刷新按钮。 |
| `dist/ipcHandlers.js` | 使用上游 Hub 归属解析，将标题栏更新限定在发送请求的 Hub 页面所属窗口；保留浏览器代理控制和下载审批接口的参数、主框架及归属校验。 |
| `dist/hubZoom.js` | 在共用缩放入口同步刷新按钮，保留原有缩放动作、目标内容和持久化逻辑。 |
| `dist/preload.js` | 保留上游浏览器及其他 API，为标题栏主题接口接入模态遮罩同步。 |
| `dist/loadingOverlay.js` | 校验完整源文件哈希；主题、圆角、尺寸和加载交接由独立启动外观补丁处理。 |

主窗口中的 `curtainView` 为持久背景层，临时启动加载视图仍由上游 `attachLoadingOverlay()` 创建；启动外观补丁会保留上游清理流程，并在实际 Hub 主题就绪后释放该临时视图。详情见 [独立外观补丁](../asar-patches/README.md)。

窗口、IPC 与共用缩放模块必须处于一致的原始状态或已修复状态，混合产物会被拒绝。已知历史 payload 升级路径仅面向当前上游代码契约，不代表兼容旧版应用的原始 ASAR。

## 使用

```bash
# 在仓库根目录执行全部回归测试（默认读取 ~/TMP/Antigravity.tar.gz）
npm test

# 单独处理一个原始 ASAR，输出到仓库忽略的 build/ 目录
node tools/window-controls/refactor-asar.js \
  /path/to/original/app.asar \
  build/antigravity-window-controls.asar \
  --icon assets/icon.png
```

该命令仅生成窗口补丁阶段的中间产物。构建完整可用的 ASAR 仍需继续应用独立外观补丁；常规打包请直接使用仓库根目录的 `bash scripts/build-asar.sh` 或 `bash build.sh`。工具拒绝原地覆盖源 ASAR（`--force` 仅用于替换已存在的其他输出路径），每次上游升级后均需重新构建并通过契约校验。

`--icon` 为可选参数，用于指定替换 ASAR 根目录 `icon.png` 的 PNG 文件（RPM 构建默认传入仓库的 `assets/icon.png`）；不传该选项则保留输入包中的原图标。输出前会校验图标字节，使用同一图标重复处理已修复包时，输出保持逐字节一致。

默认测试从原始 tar 提取输入 ASAR。若直接在当前目录运行 `npm test`，需先设置 `ANTIGRAVITY_TEST_ASAR=/path/to/original/app.asar`。

## 可选 Electron 验证

可先在仓库根目录运行 `npm run test:browser`（不打开可见窗口，使用独立临时配置）。该测试需要系统已安装 Chrome，或通过 `BROWSER_BIN=/path/to/chromium` 指定 Chromium；它以真实浏览器 DOM/CSS 验证 `pointer-events: none` 遮罩、显隐、局部遮罩、层叠顺序与主题恢复（在虚拟时间下用定时器调度动画帧，真实 Electron 的原生帧调度由下面的窗口测试覆盖）。

如需运行真实 Electron 验证脚本，请使用独立的测试运行目录与临时配置，不要覆盖日常使用的 Antigravity 安装目录或个人配置：

- `test/electron-window-smoke.cjs`：需通过 Electron 应用入口启动，设置 `WINDOW_CONTROLS_PAYLOAD` 为本目录 `payload/windowControls.js` 的绝对路径，并设置 `WINDOW_CONTROLS_TEST_PROFILE` 为独立临时用户目录。
- `test/modal-electron.cjs`：同样需要设置 `WINDOW_CONTROLS_TEST_PROFILE`，并将 `MODAL_TEST_PRELOAD` 指向从修复后 ASAR 提取的 `dist/preload.js`（需同时提取相邻依赖文件）。运行后会打开可见窗口，检查遮罩打开、关闭、叠加、局部遮罩和自定义主题恢复。
- `test/appearance-electron.cjs`：位于仓库根目录，基于 `BaseWindow` 与 Hub 内容视图验证启动配色、Logo 居中、圆角、主题交接与沙箱 preload。所需环境变量及分数缩放测试方式见 [独立外观补丁](../asar-patches/README.md)。
