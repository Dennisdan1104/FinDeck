# FinDeck 桌面壳（apps/desktop）

Electron 薄壳：把现有的 FinDeck Web UI 装进一个常驻桌面窗口，并补上浏览器给不了的**控制台三件套**——托盘常驻、全局热键唤起、开机自启（用户开关，默认关）。壳自身不画任何界面，只复用本地服务与现有 Web UI；它**不依赖、也不移植上游 `apps/desktop`**。

| 路径 | 内容 |
|---|---|
| `main/index.js` | 主进程全部逻辑：单例锁、拉起服务、主窗口、托盘、热键、窗口状态 |
| `main/preload.cjs` | 页面标记：在页面脚本之前给文档写 `data-shell="desktop"`，Web 壳据此把顶带留给这个窗口 |
| `assets/` | 应用图标：`icon.ico`（窗口 / 任务栏，含 16/32/48/256）、`icon-16.png`（托盘）、`icon-32.png`、`icon.png`（256 主图）、`generate-icons.py`（再生成脚本） |
| `package.json` | `@deepseek-ai/dsh-desktop`（private，不进发布集），`main: main/index.js`，纯 ESM JS，无构建步骤 |
| `README.md` | 本文件 |

## 启动

前置条件：仓库根目录已 `pnpm install`，且 `pnpm run build` 已产出 `apps/cli/lib/bin.js`（壳通过 `start-findeck.ps1` 启动服务，该脚本会检查这个文件）。

```powershell
# 方式一：走 workspace
pnpm --filter @deepseek-ai/dsh-desktop start

# 方式二：直接进目录
cd apps/desktop
npx electron .
```

首次运行前需要装依赖（仓库根目录执行一次即可）：

```powershell
pnpm install
```

`pnpm-workspace.yaml` 的 `allowBuilds` 里已登记 `electron: true`（pnpm 默认拦截依赖的安装脚本，不登记会直接装失败）。如果 electron 的平台二进制从 GitHub 下载过慢，可临时换镜像重跑安装（产物进 `%LOCALAPPDATA%\electron\Cache`，之后不再走网络）：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
pnpm install
```

## 三件套

| 能力 | 位置 | 说明 |
|---|---|---|
| 托盘常驻 | 通知区域 FinDeck 图标 | 关闭窗口 = 隐藏到托盘，不退出；左键单击图标切换显示 / 隐藏（与热键同）；托盘菜单「显示 FinDeck / 重启 FinDeck / 刷新页面 / 开机自启 / 退出」，「退出」才真正结束 |
| 全局热键 | `Alt+Shift+D` | 任意前台应用下可切换主窗口显示 / 隐藏 |
| 开机自启 | 托盘菜单「开机自启」勾选项 | **默认关闭**；`app.setLoginItemSettings` 只在勾选/取消时写入 HKCU 登录项 |

服务本身是独立常驻进程（由 `start-findeck.ps1` 启动），退出桌面壳不会杀掉它——这正是托盘常驻的意义：壳关了，正在跑的会话/流水线不受影响。

## 窗口外观

主窗口用 `titleBarStyle: 'hidden'` 加一层透明 `titleBarOverlay`：整条系统标题栏去掉（窗口最上沿没有标题栏底色、也没有那条 1px 分隔线），最小化 / 最大化 / 关闭仍是原生按钮，浮在页面右上角。为避免这些按钮压住内容，Web 壳（`ui-shell`）按 `env(titlebar-area-height)` 在每一列上方留出同样高度的空条带，并让该条带可拖拽；全页视图的返回条（`pageBar`）同样可拖拽。该条带只属于这个窗口：preload（`main/preload.cjs`）在页面脚本之前给文档写 `data-shell="desktop"`，Web 壳据此保留条带；普通浏览器标签页没有这个标记，因此不预留条带（左栏顶部不再留空，侧栏开关改乘侧栏首行）。

关闭按钮仍然走「关闭即隐藏到托盘」的既有语义，退出改用托盘菜单的「退出」。

## 图标资产

窗口标题栏与任务栏读 `assets/icon.ico`（多尺寸 16/32/48/256），托盘读 `assets/icon-16.png`；两者出自同一枚 256px 主图（另有 `icon.png`、`icon-32.png` 备用）。图形是深墨蓝圆角方块 + 上升折线：底色取 `--dsw-static-neutral-bluish-950` 向 `--ad-accent`（#2f54eb）混 18%（得 #1a203d），折线取暗色主题品牌主色 `--dsw-static-deepseek-450`（#5686fe）。纯代码绘制（无设计源文件），8 倍超采样后 LANCZOS 降采样，16px 下仍可辨为上升折线。

改图就改 `assets/generate-icons.py` 里的几何常量再重跑（会覆盖写回 `assets/` 下四个文件）：

```powershell
# 仓库根目录执行；Pillow 只用于生成资源，不是运行时依赖，也未进 requirements-data.txt
& "finance\python\.venv\Scripts\python.exe" apps\desktop\assets\generate-icons.py
```

venv 里没有 Pillow 时先 `& "finance\python\.venv\Scripts\python.exe" -m pip install pillow`。

图标资源缺失或无法解码时，`main/index.js` 退回进程内绘制的 16x16 蓝色方块并 `console.error`——图标问题不会挡住启动。

## 状态文件

全部位于 `~/.findeck/desktop/`：

| 文件 | 格式 |
|---|---|
| `window-state.json` | `{ "x": number, "y": number, "width": number, "height": number, "isMaximized": boolean }`，move/resize 后防抖写入；窗口最大化时记录还原后的边界 |
| `settings.json` | `{ "openAtLogin": boolean }`，默认 `false` |

删除这两个文件即可回到默认状态（1400x900 居中、自启关闭）。窗口位置若落在已拔掉的显示器上，壳会退回默认尺寸居中显示。

## 无头自检

`--smoke` 走与正常启动相同的路径（单例锁 → 拉起/复用服务 → 读认证 URL → 建隐藏窗口 → 加载完成），打印 `SMOKE OK <url>` 后退出 0；任何一步失败打印 `SMOKE FAIL: ...` 并退出 1。它不创建托盘、不注册热键、不显示窗口。

```powershell
npx electron . --smoke
```

## 已知限制

- **没有安装包**：本轮不做 electron-builder / 自有分发，双击图标只是 `electron .` 的开发形态。
- 需先 `pnpm run build` 让 `apps/cli/lib/bin.js` 存在，否则壳会在错误对话框里提示服务未起来。
- 认证 URL 取自 `~/.findeck/logs/web-server.out.log`，但日志里可能还留着上一次启动的旧 token（换服务时日志会被截断，存在时间差）。壳会逐个候选 URL 做 303 校验，只加载属于当前这次启动的 token，因此冷启动会多等几秒才出窗口，而不是加载出一个「需要认证」的页面。
- 若 3081 端口被非本启动器管理的进程占用，启动器会拒绝启动并让壳报错（日志见 `~/.findeck/logs/web-server.err.log`）。
- 开机自启写的是 `HKCU\...\Run` 下名为 `FinDeck` 的项，值为 `<electron.exe> "<apps/desktop 绝对路径>"`；因为还没有安装包，这条命令绑定的是仓库里的 electron，移动仓库后需重新勾选一次。壳启动时以及每次切换该开关时，都会顺手删除改名（AlphaDeck → FinDeck）前遗留的 `Run\AlphaDeck` 项，避免机器上留一个会再拉起一份程序的孤儿自启项。
- 托盘图标与窗口/任务栏图标是 `assets/` 下的二进制资源（见「图标资产」）。因为还没有安装包，资源管理器、开始菜单里显示的仍是 electron.exe 自带的 electron 图标；只有运行时窗口左上角 / 标题栏、任务栏按钮和通知区域用的是 FinDeck 图标。

## 实机确认清单

自动化已跑过并通过的部分（见下），这些只需偶尔复验；剩下的只能靠人眼看和真实重启。

**已自动验证**：窗口能打开并加载 FinDeck 页面（标题 `FinDeck`，非「需要认证」页）；`Alt+Shift+D` 在窗口可见 / 隐藏间切换；关闭按钮只隐藏窗口、进程存活；退出壳后服务仍在 3081 上；注册表 `Run` 项随开关出现 / 消失；删掉 `settings.json` 启动不会写入自启项；移动 / 缩放后重启窗口回到原位。

**仍需你在实机上确认**：

1. **托盘图标出现**：启动后看通知区域是否出现深墨蓝圆角方块 + 蓝色上升折线图标（自动化只能确认图标位图非空、尺寸 16x16、`Tray` 与菜单构造成功，看不到通知区域）。
2. **窗口 / 任务栏图标**：任务栏按钮与窗口左上角（Alt+Tab 切换器）显示同一枚图标，而不是 electron 默认图标——`BrowserWindow` 的 `icon` 只在运行时生效，自动化开的是隐藏窗口，看不到这几处。
3. **托盘菜单可用**：右键图标 → 菜单有「显示 FinDeck / 重启 FinDeck / 刷新页面 / 开机自启（登录时启动 FinDeck）/ 退出」五项；点「显示 FinDeck」窗口回来，点「重启 FinDeck」进程换新（窗口状态保留），点「刷新页面」页面重新加载（隐藏状态下不会把窗口弹出来），点「退出」进程与图标一起消失。左键单击图标本身也应切换显示 / 隐藏。
4. **自启真的生效**：勾选「开机自启」后重启电脑，确认登录时 FinDeck 自动出现；取消勾选后重启不再出现。
5. **热键在别人为前台时生效**：焦点切到记事本等应用再按 `Alt+Shift+D`（自动化是用注入按键验证的，等价但值得亲眼一看）。
