# 开发指南

[English](development.md) | 中文

搭建教程引导新贡献者从准备前置条件开始，直到检出目录构建通过。后面的贡献者参考介绍仓库布局和日常工作流。设计依据与实现细节属于链接的 Agent Note 和脚本。

<a id="setup-tutorial"></a>

## 搭建教程

### 前置条件

- Node.js 支持 22.19+ 与 24+；见 [Node 引擎下限 Agent Note](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.zh.md)。
- 启用了 Corepack 的 pnpm。仓库在 `package.json` 中固定使用 `pnpm@11.7.0`；如果 `pnpm --version` 无法通过 Corepack 解析，请先运行 `corepack enable`。
- Git 2.26 或更高版本。
- 可选：一个 DeepSeek API key，用于 Web、headless 和 ACP（Agent Client Protocol）自动化 agent（智能体）演示。

### 首次搭建

在仓库根目录安装依赖：

```sh
pnpm install
```

`pnpm install` 只安装依赖：它不配置任何 Git 钩子，也不配置任何合并驱动。

新克隆后请先构建一次：

```sh
pnpm run build
```

构建成功退出即表示搭建完成。

## 贡献者参考

<a id="typescript-project-layout"></a>

### TypeScript 项目布局

仓库使用相互隔离的 Host 与 Client aggregate。普通包只登记进其中一个 aggregate；Host 包进入 `tsconfig.host.json`，Client 包进入 `tsconfig.client.json`；`host/webserver`、`compaction/compaction` 与 `typert/registry` 三个包被两个 aggregate 同时引用，作为共享 leaf，让两侧对同一份源码做类型检查。

| 文件 | 角色 | 是否构成 program？ |
|---|---|---|
| `tsconfig.json` | solution 根：`extends` base、`files: []`、引用两个 aggregate。它是 tsserver 发现入口，也是显式执行整张 Project Reference 图时的入口；经继承的 `paths` 充当 tsx 运行 `scripts/` 时的解析配置。 | 否 |
| `tsconfig.host.json` | Host aggregate：Host 包、`scripts/`、`website/`，以及 `api/remotes` 的 Host 特例 project。 | 是 |
| `tsconfig.client.json` | Client aggregate：`packages/client/*` 包、`apps/web`，以及 `api/remotes` 的 Client 特例 project。 | 是 |
| `tsconfig.base.json` | 共享 compilerOptions 与源码 `paths` 映射：每个 extends 它的 project 都经它把工作区 import 解析到 `src`；它不带 `include`，因此这些 `paths` 对所有 project 生效。 | 否 |
| `tsconfig.base.client.json` | 浏览器编译设置（`jsx`、DOM lib、`types: []`），由 Client aggregate 和每个 `packages/client/*` 包 extends。 | 否 |

Host 与 Client 保持两个 aggregate program，是因为两侧在相同键下以不同服务对 cordis `Context` 接口做声明合并；单一 program 同时看到两份合并会报冲突。这种冲突只存在于 `ts.Program` 内部——模块解析永远不会触发它——所以 solution 可以同时引用两个 aggregate，一个 paths 门面也可以横跨两侧。由此推出三条纪律：

- `tsconfig.base.json` 永不添加 `include` 或 `files`：它们会泄漏进每个 extends 它的包项目，并收窄门面的全匹配范围。
- 构造全仓 `ts.Program` 的脚本显式以 `tsconfig.host.json` 或 `tsconfig.client.json` 为种子——根 solution 永不作为种子，因为把两个 aggregate 展平进一个 program 会撞上 `Context` 合并冲突。
- 新包只登记进一个 aggregate；只有上述拆分包同时携带两个 leaf 配置，共享 leaf 因两侧需要对同一份源码做类型检查而登记进两个 aggregate。包同时具有 Node loader 入口和 browser 入口并不构成拆分理由；普通 Client 插件的两份运行时产物都在 Client 构建阶段生成。

拆分 Host/Client tsconfig 的包有六个：`api/remotes`、`api/gateway`、`api/session-controller`、`api/workspace-controller`、`client/connection` 与 `session-query/session-log-export`。`api/remotes` 的 Host 入口进入 Host Typert 图，而 Client 入口导入生成的 `/remote` 声明；`session-log-export` 则让 Node archive 生产代码不进入浏览器 controller。每个拆分包根 `tsconfig.json` 因此只作为 solution，两个 aggregate 和直接消费方分别引用 `tsconfig.host.json` 或 `tsconfig.client.json`。引用方必须按目标的 compiler face 引用：单一配置的目标可由任一 face 引用，拆分配置的目标则必须经匹配的 leaf 引用，不得引用 solution 根或另一侧 leaf。两个 leaf 配置同时存在，就是判定该包为拆分包的标准。[`api-remotes` README](../packages/api/remotes/README.zh.md) 与 [`session-log-export` README](../packages/session-query/session-log-export/README.zh.md)分别说明其拆分。

根构建按生成依赖排序：

```sh
tsc -b tsconfig.host.json
tsdown --env.DSH_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
```

两次 tsdown 都使用同一组完整 workspace 匹配，不扫描构建产物来发现 Client 包，也不维护 Host/Client 包过滤表。包内 tsdown 配置根据 `DSH_BUILD_FACE` 决定当前阶段的入口：普通 Client 插件在 Client 阶段同时生成 Node loader 与 browser bundle；`api-remotes` 通过 `hostPhase: true` 提前生成 Host 入口，再在 Client 阶段只生成 browser bundle。tsdown 只消费 `lib/types` 中由前置 tsc 发射的 JavaScript。

Typert 只在 Host tsdown 中以 `tsconfig.host.json` 为种子运行。它分析 Host 类型并生成 Host 反射产物及 Host-for-Client Remote 投影；Client tsdown 不启动 Typert。因此 `pnpm run build` 会先走完整个 Host lib 阶段——tsc 加 Host tsdown，也就是包含 Typert——再运行 Client tsc，然后继续执行 Client tsdown 和 Web 构建。该顺序的决策记录见 [API Remotes 生成约定构建 Note](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.zh.md)。

`pnpm run build` 会内联根包版本、七位源码 commit，并在 Git 报告本地变化时内联 dirty 标记；调用方提供的其他 `DSH_CLIENT_*` 值也会被继承。`pnpm run build:official` 是与 release 产物构建等价的跨平台本地命令，并省略本地 dirty 标记。每次完整构建成功后都会写入一份被 gitignore 的记录，把精确公开值与 Vite 输出及动态 client bundle 绑定；release 打包会拒绝缺少记录或被后续局部构建改动的产物。`pnpm run dev:web` 仍需要先执行完整构建来准备产物树，但会在启动时读取一次当前版本和 Git 状态，并在本次会话的所有 watcher stage 之间共享该环境；它不会校验完整构建记录，因为 watcher stage 会重写记录覆盖的产物。

工作区 import 在本仓库所有做类型检查的 program（包括 `tsc -b` 自身）中都经 base 的 `paths` 映射解析到 `src`；构建产物 `lib/` 只在某条命令显式依赖构建时才被消费。生成的 Host-for-Client Remote 声明是唯一的顺序约束：它们出自 Host tsdown 阶段，因此任何需要它们的动作都必须先走 Host lib 阶段。两个 aggregate 的设置见 [solution-root Note](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.zh.md)，tsc-first 发射职责见 [ts-build-config Note](../.agents/notes/implemented/process/2026-06-17-ts-build-config.zh.md)，生成顺序见 [Typert Remote Agent Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md)。

业务服务在 Host 使用 `@Remote` 或 `@RemoteScope` 声明可调用方法；Host 构建生成 Host-for-Client 类型与运行时贡献，Client 的 `api-remotes` 组合加载这些贡献并挂到 `ctx.remote` 与作用域 `agentCtx.remote` namespace。两侧的生成产物、装配关系、SRC 开发回退和 Web 构建顺序见 [API Gateway](api-gateway.zh.md)。

`pnpm run build` 产出可运行的产物树：tsc 在 `lib/` 下发射声明与中间 JavaScript，tsdown 打包运行时代码，`build:web` 产出浏览器 bundle。新 worktree 在构建前什么都没有。没有任何东西校验包入口点或构建出的声明，包的 `exports` 字段靠「构建后启动产物」来确认。

### 环境变量

真实的 DeepSeek 适配器和需要密钥的 agent 演示从环境变量或仓库根目录一个被 gitignore 的 `.env` 文件读取凭证：

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` 可选，默认为公开 API。请勿提交真实凭证。

### Git 集成

本 fork 不安装任何 Git 钩子和合并驱动：`pnpm install` 不在 `.git` 下写入任何东西，`core.hooksPath` 保持未设置，提交、合并、推送都走普通 Git。Markdown 链接可解析与翻译配对是评审者确认的约定，不是机器执行的检查。禁止新增钩子、钩子安装器或 pre-push 检查的常设规则见根目录 [AGENTS.md](../AGENTS.md)。

[`vendor/README.md`](../vendor/README.md) 中的 vendor manifest（元数据清单）由人工维护：改动 `vendor/*/src` 时，请在同一个提交里更新对应条目。

### 日常命令

根目录的[贡献者说明](../AGENTS.md#commands)概述常用命令，脚本清单以 [`package.json`](../package.json) 为准。`pnpm run build` 是唯一的类型检查，所以宣布改动完成前请先跑它，然后按[验证](testing.zh.md)所述用真实输入跑一遍受影响的路径。包公开行为变更还需更新所属 README 或 JSDoc。

### Profile 运行

从源码 checkout 运行这些演示前，请单独执行仓库构建：

```sh
pnpm run build
```

单次运行的 Headless coding agent 需要环境变量或仓库根目录 `.env` 中的 `DEEPSEEK_API_KEY`：

```sh
pnpm dsh --profile headless "summarize this workspace"
```

PTC mode 演示启用代码式工具展示，并运行同一个 headless profile：

```sh
pnpm run demo:ptc -- "summarize this workspace"
```

### TODO 标记

请使用以下三种注释标签之一标记代码中的已知问题，按紧急程度排序：

- `FIXME`：应当阻塞新版本发布的问题。除非评审者明确同意该更改可以合并，否则发布版本不应包含未解决的 `FIXME`；
- `TODO`：应当尽快修复的问题，等资源到位即可处理；
- `XXX`：也许某天会修复的问题，优先级最低，不作承诺。

请选择与紧急程度匹配的标签，让浏览代码的人一眼分清「发布阻塞」和「有空再说」。

<a id="documenting-types-verbatim-ts-type-equiv"></a>

### 逐字记录类型定义（`ts type-equiv`）

[子系统](subsystems/README.zh.md)页面会把与源码等价的声明及其原始 JSDoc 一并粘贴，让读者看到确切类型定义和源码约定。这类粘贴请围栏为 ` ```ts type-equiv `（而不是 ` ```ts `），把它标记为与源码等价的代码块，而非独立编写的示例代码；对于不应把实现体写进目录的类，请使用 ` ```ts public-api `，它保留公共字段、构造函数、访问器、方法及其原始 JSDoc，同时省略实现体和私有或受保护成员。配对 `.zh.md` 中的代码块与其无后缀兄弟文件保持相同的围栏类型和逐字节一致的正文。

没有任何东西会提取符号或把代码块与源码比对，因此保持一致靠人工：当你改动一个已记录的类型声明或其 JSDoc 时，请在同一个变更里更新它的每一处粘贴。
