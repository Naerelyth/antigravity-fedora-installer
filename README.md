# Antigravity Fedora

为 Antigravity 官方 Linux x64 归档（`.tar.gz`）应用本地窗口与外观补丁，构建 Fedora x86_64 RPM 安装包或独立 `app.asar`。

构建过程会从 ASAR 内的 `package.json` 自动读取应用版本，并在修改前校验关键模块的完整 SHA-256。一旦检测到未适配的上游代码变更，构建会立即中止。整个流程不联网下载上游包、不修改原始归档，也不会自动安装软件。

当前代码契约基线为 Antigravity 2.31.2。其他版本只要相关模块未发生契约漂移，同样可以通过校验；若校验失败，须先完成适配再打包。

## 功能

| 模块 | 行为 |
| --- | --- |
| `window-controls` | 保留 Electron 原生窗口按钮；overlay 背景保持 `#00000000` 透明，与网页标题栏共用背景与遮罩。高度以 35 CSS px 为基准，随页面缩放乘算并向下取整（缩放系数限制在 0.25–5），图标颜色跟随主题与全窗口遮罩变化。 |
| `settings-shadow` | 独立移除设置面板（`.settings-modal-container`）的 `box-shadow`，保留模态遮罩、边框与圆角。 |
| `startup-appearance` | 运行时读取本地保存的亮／暗自定义主题；加载视图跟随窗口内容区布局并保持 Logo 居中；持久背景层、Hub 视图与加载视图统一使用 8 DIP 圆角（最大化或全屏时为 0）；等待主页面按目标主题完成绘制后再交接。 |
| 图标替换 | 使用 `assets/icon.png` 替换 ASAR 根目录的 `icon.png`；`assets/antigravity.png` 用作系统桌面图标。 |

启动主题沿用上游主题模式并在运行时读取本机配置，支持跟随系统与自定义亮／暗配色。配置为跟随系统时，启动期间切换系统亮暗模式会同步更新加载页背景、Logo 与按钮符号色，随后主页面也会按最新目标主题完成交接。自定义颜色须为 `#RRGGBB` 格式的六位十六进制值，配置缺失或无效时回退为默认配色。主页面标题栏挂载且背景色匹配目标主题后，等待两帧稳定再移除加载视图；若等待超时（上限 10 秒）或执行异常，则记录警告并回退显示主页面。实现细节见 [独立外观补丁](tools/asar-patches/README.md)。

主窗口沿用上游 `BaseWindow` 与独立 Hub 内容视图结构：持久背景层 `curtainView` 承托透明的 Hub 页面，临时加载视图负责显示启动 Logo，交接完成后仅移除临时加载视图。补丁保留上游背景层、窗口状态恢复、导航保护与关闭清理逻辑。

兼容性边界：原生按钮图标通过 IPC 同步，遮罩颜色合成支持纯色半透明 DOM 遮罩，不模拟 CSS 滤镜效果。原生圆角与缩放表现取决于桌面合成器，需在目标桌面环境中验收。

## 目录

```text
build.sh                  构建入口，可从任意工作目录调用
scripts/                  RPM 构建、仅生成补丁 ASAR 与测试脚本
test/                     外观补丁、启动交接、RPM 版本排序及 Electron 回归测试
packaging/                RPM spec 和桌面启动项
assets/                   icon.png（ASAR 图标）及 antigravity.png（桌面图标）
tools/window-controls/    ASAR 重构器、运行时模块及回归测试
tools/settings-shadow/    独立的设置面板阴影补丁
tools/startup-appearance/ 独立的启动页主题与圆角补丁
tools/asar-patches/       共用 ASAR 读写、独立补丁应用器及契约校验
docs/                     历史原包与迁移记录
legacy/                   归档资料，不参与构建
dist/                     默认输出目录（Git 忽略），存放构建产物、日志与校验清单
```

上游归档默认存放于 `~/TMP/Antigravity.tar.gz`。构建直接从归档流式提取所需文件，不依赖预先解压的应用目录。

## 构建

### 1. 准备环境与原包

构建目标仅为 Fedora x86_64，需要 Bash、Node.js 20+、GNU tar、gzip、coreutils，以及 `rpm` 和 `rpmbuild`（通过 `npm test` 运行测试时另需 `npm`）。JavaScript 工具与测试脚本仅使用 Node.js 内置模块，无需执行 `npm install`。

```bash
sudo dnf install rpm rpm-build nodejs npm tar gzip coreutils
node --version
```

请从官方渠道准备 Linux x64 原始 tar 包（默认路径为 `~/TMP/Antigravity.tar.gz`，RPM 构建脚本也支持指定其他路径）。归档内须包含 `Antigravity-x64/resources/app.asar`，且输入须为未经本项目补丁处理过的上游 Agent / Hub 发行归档。

### 2. 运行构建

以下命令均在仓库根目录执行：

```bash
bash build.sh

# 指定原包和输出根目录
OUTDIR="$HOME/rpkg" bash build.sh /path/to/Antigravity.tar.gz

# 或通过环境变量指定原包
ANTIGRAVITY_ARCHIVE=/path/to/Antigravity.tar.gz OUTDIR="$HOME/rpkg" bash build.sh

bash build.sh --help
```

输入归档优先级为：命令行参数 → `ANTIGRAVITY_ARCHIVE` → `~/TMP/Antigravity.tar.gz`。`OUTDIR` 指定输出根目录（而非 RPM 文件名），未设置时默认输出到仓库下的 `dist/`。显式传入的相对输入路径与相对 `OUTDIR` 均按调用时的工作目录解析；也可在其他目录通过绝对路径调用 `build.sh`。

构建请以普通用户身份运行，运行环境需允许写入输出目录、`/tmp` 以及 `rpmbuild` 使用的 `/var/tmp`。

### 3. 构建流程与输出

1. 从原始 tar 提取 `app.asar`，核对应用元数据与目标模块哈希。
2. 应用窗口控制补丁并替换 ASAR 图标，校验中间产物。
3. 依次应用设置阴影与启动外观补丁，校验组合产物。
4. 运行全部默认 Node.js 回归测试，并将应用版本转换为可排序的 RPM 版本号。
5. 调用 `rpmbuild` 解压原 tar，在临时打包树中用最终 `app.asar` 替换 `resources/app.asar` 并生成 RPM。

每次构建都会创建带随机后缀的独立目录。最终 `app.asar` 仅写入 RPM 的临时打包树，原始归档、已有解压目录与系统已安装应用均不受影响。

构建成功后的输出结构如下：

```text
<OUTDIR 或 dist>/antigravity-<RPM版本>.<随机后缀>/
├── x86_64/antigravity-<RPM版本>-1.fcXX.x86_64.rpm
├── app.asar
├── refactor.json
├── appearance-patches.json
├── inputs.sha256
└── build.log
```

- `app.asar`：包含图标替换与全部三个补丁的最终产物，与 RPM 内安装的 `resources/app.asar` 内容一致。
- `refactor.json`：记录原始应用版本、窗口补丁阶段的输入／输出路径及 ASAR 哈希；其中临时阶段路径在构建结束后失效。
- `appearance-patches.json`：记录外观补丁列表、改动文件及该阶段的输入／输出 ASAR 哈希；输入对应窗口补丁中间产物，输出对应最终 `app.asar`。
- `inputs.sha256`：原始归档与最终 `app.asar` 的 SHA-256 清单（不含 RPM，也不用于来源认证）。
- `build.log`：`rpmbuild` 阶段日志，不包含此前补丁与测试阶段的输出；文件名中的 `.fcXX` 后缀取决于当前 Fedora 版本。

可使用 `sha256sum -c /完整路径/inputs.sha256` 核对输入与产物。清单内记录的是绝对路径，移动文件后需同步更新路径。临时打包目录会在退出时自动清理，输出目录保留；若命令以非零状态退出，目录中可能残留未完成的产物。

### 仅生成补丁后的 ASAR（不构建 RPM）

如果只需生成补丁后的 `app.asar`，可在仓库根目录运行 [scripts/build-asar.sh](scripts/build-asar.sh)。该脚本会执行图标替换、全部三个补丁及默认 Node.js 回归测试，但不调用 `rpmbuild`：

```bash
bash scripts/build-asar.sh
```

运行需要 Bash、Node.js 20+、tar、gzip、coreutils，以及供版本排序测试调用的 `rpm`；不需要 `rpm-build` 或 `npm install`。输入归档须为未经修改的 `~/TMP/Antigravity.tar.gz`，遇到未知代码漂移会直接中止。

成功后终端会输出最终 `app.asar` 的绝对路径及 SHA-256，并在 `~/TMP` 下生成独立交付目录：

```text
~/TMP/antigravity-asar.<随机后缀>/
├── app.asar                 最终产物（图标替换及全部三个补丁）
├── refactor.json            窗口补丁阶段报告
└── appearance-patches.json  独立外观补丁阶段报告
```

原始 `app.asar` 与窗口补丁阶段的中间产物存放于 `/tmp` 的临时工作目录，脚本退出时自动清理。全部补丁和默认测试通过后，最终 `app.asar` 才会复制到交付目录；报告里的临时阶段路径随后失效，但阶段哈希仍可用于追溯。单独使用 `app.asar` 时须配合对应版本的完整上游应用目录。

注意：该脚本会自动定位仓库根目录，但输入固定为 `~/TMP/Antigravity.tar.gz`、输出固定在 `~/TMP` 下，不接受命令行参数或 `ANTIGRAVITY_ARCHIVE`、`OUTDIR` 覆盖。如需自定义输入／输出路径，请使用 [底层补丁工具](tools/asar-patches/README.md)。失败时脚本以非零状态退出，并保留诊断报告和部分产物。

## 安装与升级

构建脚本不会自动安装生成的软件包。安装或升级时，请指定构建输出中的具体 RPM 路径：

```bash
sudo dnf install /完整路径/antigravity-<RPM版本>-1.fcXX.x86_64.rpm
```

RPM 将文件安装到 `/opt/antigravity`，同时提供 `antigravity` 命令、桌面启动项及图标。安装或升级完成后，需完全退出并重新启动应用。

同一上游版本默认使用 `Release: 1`。仅调整补丁后重新构建同一上游版本时，可用 `sudo dnf reinstall /完整路径/新构建.rpm` 覆盖安装；若需递增发布号，应更新 `packaging/antigravity.spec` 中的 `Release`。

## 测试

```bash
npm test             # 从默认 tar 提取原始 ASAR，运行全部 Node.js 回归测试
npm run test:unit    # 不依赖原包的窗口运行时单元测试
npm run test:browser # 可选：在 Chrome/Chromium 中运行 DOM/CSS 遮罩测试
bash scripts/test.sh /path/to/Antigravity.tar.gz

# 浏览器测试默认调用 google-chrome，可通过 BROWSER_BIN 指定其他 Chromium 可执行文件
BROWSER_BIN=/usr/bin/chromium npm run test:browser
```

`scripts/test.sh` 同样支持通过环境变量 `ANTIGRAVITY_ARCHIVE` 指定原包路径。

默认回归测试覆盖源文件保护、图标替换、ASAR 完整性与幂等性、未知漂移拒绝、上游代码保留、窗口生命周期、多窗口 Hub IPC 寻址、共用缩放入口、外观补丁独立与组合应用、延迟主题交接及 RPM 版本排序。构建脚本会自动执行这批测试，但不会自动启动浏览器或 Electron GUI 测试。

浏览器测试使用独立临时配置且不显示窗口。原生窗口与外观测试须通过独立的 Electron 运行环境执行，不能直接用 `node` 运行：

- 窗口／遮罩测试的入口与环境变量见 [窗口控制说明](tools/window-controls/README.md#可选-electron-验证)。
- 组合补丁测试入口为 `test/appearance-electron.cjs`，需设置 `APPEARANCE_TEST_ASAR` 指向最终 `app.asar` 并设置 `APPEARANCE_TEST_PROFILE` 指向临时配置目录，详情见 [独立补丁说明](tools/asar-patches/README.md)。

进行 GUI 测试时应始终使用隔离的运行目录和临时配置。发布前仍需在目标桌面合成器下对完整上游界面、主题与缩放效果做视觉验收。

## 版本维护

获取新版官方 tar 后直接运行 `bash build.sh`。RPM 版本号与输出目录名称均由包内元数据自动推导，无需手动修改 spec。正式版本如 `2.31.2` 会保持原样；预发布标识由 `scripts/rpm-version.js` 编码到 `~` 之后（例如 `2.16.0-beta-2` 映射为 `2.16.0~bgcgfhegbcndc`），使 RPM 版本比较遵循 SemVer 顺序。构建元数据 `+…` 不参与排序，原始版本字串会保留在 ASAR 和 `refactor.json` 中。

当前 2.31.2 契约校验 `dist/utils.js`、`dist/ipcHandlers.js`、`dist/hubZoom.js`、`dist/preload.js`、`dist/loadingOverlay.js`，以及本地 payload 和各阶段变换产物的完整 SHA-256。遇到未知漂移会立即拒绝构建，不提供跳过补丁或强制忽略校验的选项；底层窗口工具的 `--force` 仅允许覆盖已存在的输出文件，不能绕过契约校验，也禁止原地覆盖源 ASAR。

遇到上游版本漂移时，需先分析新版实现与补丁依赖，更新替换规则及精确的输入／输出哈希，通过全部回归测试与真实窗口验收后再重新打包。适配过程必须保留无关的上游行为，不得通过放宽校验来绕过失败。

三个补丁相互独立，但 RPM 与 ASAR 构建入口均默认依次应用全部补丁。如需单独验证单个模块，可按各工具说明直接调用底层脚本。每次重新构建都应从官方原始归档开始，不能把已应用外观补丁的组合产物再次交给窗口重构器处理。

## 来源与许可

本仓库中的构建脚本、补丁工具与测试代码采用 MIT 协议开源，详见 [LICENSE](LICENSE)。

上游发行包需由用户自行从官方渠道获取。构建报告中的哈希仅用于本地完整性校验与构建追溯，不替代上游来源认证或数字签名验证。本项目为第三方打包与适配工具，Antigravity、Electron、Chromium 及相关图标的版权与许可均归各自权利人所有。
