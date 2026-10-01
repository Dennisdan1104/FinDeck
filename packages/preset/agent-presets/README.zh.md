---
description: "按 preset cordis.yml 文件进行按会话的 agent 组装，供选择、配置或排查 agent preset 的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-presets

[English](README.md) | 中文

## 概述

`dsh-agent-presets` 让每个 agent（智能体）会话都从同一个 preset 组装：preset 是一个目录，内含一份 `agent.cordis.yml`，列出该会话运行的插件。命名某个 preset 的会话会获得该 preset 的工具、提示词段落与 skill（技能），而其他会话各自保持自己的，因此一个进程可以同时运行多个组装方式不同的 agent。本包维护 preset 名单：它列出已配置根目录提供的每个 preset——随附的、你自己放在 `<dshHome>/.agent-presets` 下的，以及项目保留在自己项目目录下的——在 preset 无法启动会话时给出原因，并允许你通过复制既有 preset 来创建新 preset。默认 preset 是一项可按部署或按用户覆盖的设置，会话只有在尚未产出任何内容时才能切换 preset。preset 的权限恰好等于它所引用插件的权限，因此你创作的 preset 与 shell 访问权限同级。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在需要让每个 agent 会话从 preset 文件获得自己的工具、提示词段落与 skill 的组装中挂载本包。每个会话都会命名一个 preset——显式指定或通过配置的默认值——并据此组装；没有本包时，会话只能回退到宿主组装挂载的内容。

### preset 给会话带来什么

从 preset 组装的会话会运行该 preset `agent.cordis.yml` 所列插件：它的工具、提示词段落与 skill。加入同一 preset 的会话共享一份已安装的组装，且各会话的状态彼此隔离。子 agent（subagent）会加入其父方的组装，因此它看到的工具与提示词段落和创建它的 agent 相同。

可选的 preset 来自三处，并分为两层：本包 `presets/` 下随包交付的 preset 与你自己放在 `<dshHome>/.agent-presets` 下的 preset 构成**全局层**，每个调用方都看得见；每个 workspace 的项目目录则以它自己的 `presets/` 提供**项目层**。选择器会展示每个 preset 的显示名与描述；组装无法加载的 preset 会连同原因一起列出而不是被隐藏，因此你能看到该修什么或删什么。

### 全局 preset 与项目 preset

一个 preset 只属于其中一层，而所属层决定谁能看见它：

- **全局层**——随附集合、每个已配置根目录、以及 `<dshHome>/.agent-presets`——部署中的每个调用方都可见。
- **项目层**是 `<projectDir>/presets/`，其中 `projectDir` 是「包含调用方工作目录的那个 workspace」的项目目录（见 [dsh-workspace](../../workspace/workspace/README.zh.md)）。它只对该 workspace 内部工作的调用方可见：`rosterFor(cwd)` 与 `list(cwd)` 针对某个工作目录作答，而 `list()` 与 `list` Remote 只针对全局层作答。项目 preset 一律带 `user` trust，因为它是人创作的。`rosterFor` Remote 把这一按工作目录作答的读取暴露到线上，并为每一行标出它来自哪一层。

项目根目录对身在该项目内的调用方**最先**被查询，因此重复 id 由项目 preset 胜出：项目自己写了 `alpha`，就意味着它的调用方跑的是这一份。其余调用方拿到的仍是全局层，不传 `cwd` 的调用方也只读全局层。

同一个 id 可以命名两份 preset，因此项目 preset 的身份带层限定：全局层是 `global:<id>`，项目层是 `project:<projectDir>:<id>`。从项目 preset 组装出来的会话记录的就是这个限定身份，所以即便全局层供给了同名 id，resume 仍会重建它当时运行的层；不带前缀的身份命名的是全局层，也就是项目层出现之前写下的每一个会话所带的形态。两层并排存在——各自从自己的组装文件挂载并记录 stamp，彼此不共用同一份挂载。

### 最小配置

插件需要一个 `default` preset id，并在 `roots` 中扫描 preset：

```yaml
- name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: standard
    roots:
      - path: ~/company-presets
        trust: system
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `default` | 必填 | 会话未指定时组装的 preset id |
| `roots` | `[]` | 按优先级排列的扫描目录；每项提供 `path`（开头的 `~` 会展开）与 `trust`（默认为 `user`） |
| `includeShippedRoot` | `true` | 在全部已配置根目录之前，前置本包随附的 preset 作为 `system` 根目录 |
| `includeUserRoot` | `true` | 在全部已配置根目录之后追加 `<dshHome>/.agent-presets` 作为 `user` 根目录 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-agent-presets)是每个受支持字段及其 JSDoc 的穷尽式真源。

随附根目录前置在全部已配置根目录之前，因此即使补丁替换 roster 配置，内置集合仍然可用并赢得重复 id。`includeShippedRoot: false` 会为完全自行提供 preset 的部署移除内置集合。`includeUserRoot: false` 会移除推导出的可写根目录；钉住确切 roster 的测试会同时关闭两个推导根目录。

### 选择默认 preset

`default` 配置设定部署级默认值。当组装中存在 settings 提供方时，本插件会注册 `agent-presets` 命名空间，并以 `config.default` 作为其 base，因此用户文档会在部署默认值之上层叠一份按用户设置的默认值：

```yaml
agent-presets:
  default: minimal
```

该值在会话创建时读取，因此更改默认值只影响此后创建的会话；运行中的会话仍停留在它们当初据以组装的 preset 上。清空用户字段即重新继承组装默认值。

### 创作 preset

创作有两条写入路径，都不接受组装文本。**复制**把某个既有 preset 的整个目录——组装、展示元数据、skill 目录与资产——复制进第一个 `user` 根目录，从而创建一个 preset。**保存**（`AgentPresets.save`，即 `savePreset` Remote）以同样方式创建模式，然后替换副本的 `preset.yml`；或改写某个既有用户 preset 的 `preset.yml`：显示名与描述，以及它的模式声明。组装从来不是参数，所以没有调用方能改变会话挂载哪些插件，一次写入也不会授予源 preset 尚未携带的能力。`remove` 则会从它被发现的所属层删除这样一个 preset。

保存会指名它写入的层。默认目标是部署的第一个 `user` 根目录；`target: 'project'` 配合调用方工作所在的 `cwd` 会改为写进该项目的 `presets/`，成果只对该项目内部的调用方可见。`project` 目标缺少 `cwd`、或其 `cwd` 不被任何 workspace 包含时会被拒绝（`agent-preset/invalid`），而不是悄悄退回全局层；当它解析到的 preset 位于另一层时，保存会被拒绝（`agent-preset/read-only`）——项目写入不能改写全局 preset，全局写入也不能改写项目 preset。

副本保留来源的描述（除非请求另给一个），丢弃来源的名称与名单 `order`——副本若与来源完全同名、或被排进随部署发布那批的次序，名单就无法再区分二者——并在以下情况被拒绝：id 不符合 `[a-z0-9][a-z0-9-]*`（id 会成为目录名）、id 已被占用（复制从不覆写）、或来源未知。对随部署发布的 preset、或位于可写根目录之外的 preset 执行保存会被拒绝（`agent-preset/read-only`）；改写在请求中省略的字段保留 preset 已存的值，名称写成空白也视同省略。新建时若 `preset.yml` 写入失败，不会留下任何目录。

删除只移除本地创作的 preset；随部署提供的 preset 不可删除。已在被删除 preset 上运行的会话会继续运行。

### 声明会话模式

同一份 `preset.yml` 在展示文本之外还携带 preset 的模式分类——`dsh-mode` 读取这对字段驱动会话内模式切换与流程界面：

```yaml
name: 研究模式
mode_kind: work        # work = flow required | free = lightweight/discussion (absent means free)
flow:
  steps:
    - id: plan         # kebab-case, unique within the flow
      label: 规划      # display name, localized by the preset author
      model: default   # default follows the session model, or provider/model
      prompt: |-       # what this step does; optional, and read by the model
        拆解问题，写出假设。
        确认数据口径。
```

`mode_kind: work` 没有合法 `flow` 即在发现时判为损坏——名册行携带原因、所有挂载路径拒绝之，因为没有流程的工作模式无法运行模式系统。`free`（或未声明）的 preset 无流程义务；多余携带流程会被判为矛盾而拒绝。步骤的 `prompt` 是可选散文：键缺失与留空并不等同——缺失表示这一步只以标签命名，而留空会被拒绝，不会作为一条空声明存下。非法步骤形状会指名出错的步骤；带控制字符的步骤模型会被拒绝，因为流程段把每个模型渲染在模型自身指令的同一行上。步骤还可以声明 `cluster`，表示该步骤由 AI 集群执行——多个并行 subagent 从不同视角做同一件事再聚合：`perspectives` 列出这些视角（1–8 个非空字符串；省略则用执行器的默认面板），`strategy` 指定聚合方式（`synthesize`（默认）或 `vote`）。声明驱动什么见 [dsh-mode](../mode/README.zh.md)。

### 切换会话的 preset

会话只有在尚未产出任何内容——没有消息或工具调用——时才能切换到不同的 preset。此后组装在会话的生命周期内固定，因为在对话中途调换工具会留下新组装无法执行的已记录工具调用。已提交的切换会发出 `tools/change`，因为解析后的工具集在没有注册表编辑的情况下发生了变化。切换也会记入会话日志，因此恢复或 fork 的会话会按它运行的组装重建；切到项目 preset 时记录的是该 preset 的限定身份，理由相同。

### 失败与恢复

组装缺失、无法解析、不是具名插件行列表，或者引用了无法解析的模块的 preset 会被列为 broken，原因会指名出问题的行；组装此类 preset 会被提前拒绝，因此会话绝不会以半组装状态启动。能活到会话创建的，是模块能加载但随后拒绝的行——抛错的插件，或等待组装从未提供的服务的插件——它会让创建失败并回滚，且会指名每一个失败的行，包括组内的行。修复 preset 的文件或删除它，然后重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释名单与常驻挂载背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **每个 preset 每层一份常驻组装。** preset 在进程内只挂载一次，挂到常驻 scope 之下；agent 通过把自己的 scope key 认父到该挂载来加入，因此挂载的注册与监听器覆盖每个已加入的 agent，而不覆盖兄弟 preset 的。挂载以带层限定的 preset 身份为键，因此全局层与某个项目层里的同一个 id 是两份组装，绝不会被误当成同一份共用。
- **代际以组装文件为键。** 挂载记录组装文件的 stamp（mtime 与大小）——即命中那一层自己的文件；发现 stamp 过期的会话会开启下一个代际，而已加入的会话保持各自运行的那个代际——运行中的会话在文件被修改或删除后继续存活。
- **preset 文件是输入，绝不是持久化目标。** 被挂载的子树把 `write()` 覆写为空操作，因此 loader 发起的写回绝不会重写共享的 preset 文件。
- **两层，一条优先级规则。** 全局层只推导一次；项目层按调用方的工作目录逐次推导并放在它之前被查询，因此项目自己的调用方拿到的是项目里那份重复 id，而没有项目的调用方只读到全局层。
- **发现过程拥有健康。** 组装缺失或不可加载的目录是携带原因的 broken 名单行，而不是被跳过——被跳过的目录仍占着它的 id，而任何界面都没有可删的东西。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务入口：`Config` schema、settings 命名空间、名单 API、常驻挂载协调 |
| [`src/discovery.ts`](src/discovery.ts) | 文件系统发现：根目录扫描、健康检查、id 校验、排序 |
| [`src/composition-inventory.ts`](src/composition-inventory.ts) | 面向插件清单表面的压平组合行：文件读取（求值 disabled 门）与挂载读取（携带 fiber 状态） |
| [`src/preset.ts`](src/preset.ts) | 词汇体系：preset id 规则、`AgentPreset` 与 `PresetRoot`、错误类型 |
| [`src/mount.ts`](src/mount.ts) | 子树挂载、宿主 base-URL 处理、挂载审计、`write()` 抑制 |
| [`src/authoring.ts`](src/authoring.ts) | 本地创作 preset 的复制/删除/读取、创作写入共用的 `preset.yml` 渲染器、权限收紧 |
| [`src/metadata.ts`](src/metadata.ts) | `preset.yml` 展示元数据（文件的展示半边） |
| [`src/mode.ts`](src/mode.ts) | `preset.yml` 模式声明：`mode_kind` 与 `flow` 校验（文件的语义半边） |
| [`src/session.ts`](src/session.ts) | `agent-preset/selected` 事件与 `agentPreset` Session 投影 |
| [`src/types.ts`](src/types.ts) | client-safe 的线上载荷与 cordis 事件声明 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：挂载后的服务泄漏复查、未加入 agent 的失败 |

### 常驻挂载

`ensureStanding` 为每个带层限定的 preset 身份保留一个进行中的 promise（single-flight），因此两个竞争首次使用同一 preset 的 agent 共享一份组装，而同一个 id 出现在两层时绝不会共用。已结算的失败会被移除，以便后续会话重试文件已被修复的 preset。挂载运行在 roster 服务自己的未追踪上下文中——从被追踪上下文派生的子树会经调用方的 shadow fiber 解析服务——因此它比任何 agent 都活得久，只随整棵树卸载。`serviceForAgent` 读取某 agent 对其 preset 挂在 `isolate` realm 之后（组外不可见）的某个服务实例。

### 组合清单

`compositionInventory()` 向插件清单表面提供每个预设的压平行及其名单身份（id、trust、显示名、默认标记）：已有存活 standing mount 的预设由其最新世代的 Loader 条目作答——匹配限定在本运行时自己的 root 内，同进程里的第二个 Cordis 运行时不会替它作答；即使文件事后损坏也照常作答，因为挂载才是会话实际运行的组合，broken 裁决只适用于无人组合的预设——开机以来从未被组合的预设由其组合文件作答，`!!js` disabled 门用 Loader 上下文求值，使两种答案反映同一台宿主。全局层一如既往从文件系统列出，存活的**项目层**挂载则列在它旁边——这也是一个部署级读取对「只有工作目录才能选中的层」所能知道的一切。读取从不挂载预设——列出所有组合的设置页不会激活其中任何一个。求值器拒绝的门保持 `'conditional'`；在发现的健康裁决与行读取之间变得不可读的文件，会携带竞态原因报告为 broken，而不是被静默丢弃。`./display` 子路径导出 `presetDisplayText` 纯函数，把内置预设 id 映射到各自的字典文案键；它没有任何 import，浏览器包直接内联，也是「哪个内置 id 对应哪份文案」的唯一归属地。

### 挂载审计

直接挂载的子树不会出现在 `ctx.loader.entries()` 中，因此没有启动审计能覆盖它；`mountPreset` 自行证明结果可用，并拒绝三种形态：无 scope 的目标（preset 的工具会注册成全局的）、仍在等待组装从未提供的服务的行、以及把服务发布进根 realm 的行（进程级全局，第二个发布同名服务的 preset 会相撞）。不变式伴生插件在每次服务通知时复查最后一条规则，因为从定时器或异步续体发布的行会绕过一次性审计。

### 创作机制

复制会解引用符号链接以保证自包含，把目录树收紧为仅属主可用（文件 `0o600` 并保留属主执行位，目录 `0o700`），并在首次复制时创建根目录。复制出的 `preset.yml` 会被重写：保留来源的描述供作者编辑，丢弃其名称与 roster `order`，从而让名单始终能区分副本与来源。文档渲染器把每个自由文本标量——步骤的 label、model 与声明的用途——都写成双引号 YAML 标量，因此带 YAML 标点或换行的值始终是一个值，不会变成结构。删除拒绝随部署提供的 preset，并清除指向刚删除 preset 的用户默认值。

### 会话记录

创建 header 记录会话启动时使用的 preset；`agentPreset` Session 投影记录会话运行时使用的 preset。切换在替换提交后追加 `agent-preset/selected` 事件，因为 preset 决定模型看到的工具 schema 与提示词段落。服务把这项已提交事实重新发为不带 scope 的 cordis 事件 `agent-preset/selected(sessionId, agentPreset)`。重建消费该投影；投影从创建 header 开始并应用最新选择，绝不单独折叠日志。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面；它们从组装模型逐步进入挂载所依赖的 scope 与提示词机制，以及决策证据。

- [persona 包](../persona/README.zh.md)——preset 挂载的可组装行，让会话拥有自己的人设。
- [mode 包](../mode/README.zh.md)——声明出的流程所驱动的运行时。
- [模式创作工具](../tool-preset-authoring/README.zh.md)——本包「可创作的那一半」之上的、面向模型的调用。
- [Scope 子系统](../../../docs/subsystems/scope.zh.md)——scope key 与 agent 加入所经由的父链。
- [系统提示词子系统](../../../docs/subsystems/system-prompt.zh.md)——preset 提示词段落如何注册与组装。
- [会话包映射](../../session/README.zh.md)——preset 切换所追加的持久会话记录。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-agent-presets)——每个受支持配置字段及其源声明。
- [按会话组装 agent preset 的 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.zh.md)——设计理由与备选方案。
- [按 preset 常驻挂载的 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-08-per-preset-standing-mounts.zh.md)——挂载为何是常驻且共享的。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经由 preset 常驻组装安装的插件：这些插件拥有该 preset 向加入它的 agent 呈现的每个工具 schema、提示词段落与 skill。

#### KV Cache 影响

在一个 agent 的整个生命周期内保持前缀稳定：组装只装入一次，发生在 agent 发布之前、因而也在它的首个请求之前，且在 agent 运行期间不再重新读取。为新会话选择不同的 preset，只会为该会话建立不同的前缀，无法让任何已在运行的会话失去缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明名单何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是通用组装对比或任务积压。

- **位于可写根目录之外的 preset 可被发现却无法写入**——`remove()` 与 `save()` 拒绝任何不在第一个 `user` 根目录下的 preset，因此一个既配置了自有可写根、又保留 `includeUserRoot` 的部署，会列出并挂载 harness home 下的 preset，却对每次删除与改写回答「它不在可写 preset 根目录之下」。只想要自有 preset 的部署应设置 `includeUserRoot: false`。
- **项目 preset 对该项目的调用方遮蔽同 id 的全局 preset**——项目根目录最先被查询，因此一个项目若自己命名了 `standard`，随附的 `standard` 在它内部就不再运行。全局行对其余调用方仍然可见，两份也仍可分别挂载，但没有任何提示告诉使用者项目正在覆盖一份随附 preset；想两份都在视野里，就关掉项目层或给项目 preset 改名。
- **项目 preset 记录的身份是名单行不会写出的带层限定形态**——从项目 preset 组装出来的会话记录 `project:<projectDir>:<id>`，按 id 与发现结果行比较的界面匹配不上。要按会话标出「正在运行的 preset」的表面，需要把身份的层与裸 id 解回某一行（延期项）。
- **`dsh-mode` 仍按全局名单解析模式 id**——`/mode` 列表与 `mode:flow` 提示词段落读的是 `list()`，它只对全局层作答，因此运行项目 preset 的会话渲染不出流程段，`/mode` 输出里出现的也是原始身份（[缺口](../mode/README.zh.md)）。组装自身安装的内容不受影响。
- **会话一旦产出任何内容便无法更换 preset**——切换会把空白会话的父作用域重链到另一个常驻挂载，且仅限空白会话：在对话中途调换工具会抽走模型已调用的工具。
- **代际只以组装文件为键**——stamp 检查只察觉 `agent.cordis.yml` 的变化，察觉不到旁边 skill 文件或资产的编辑；那些编辑要等组装文件本身变动或进程重启才达到新会话。
- **被替代的代际永不回收**——已加入的会话保持其运行所在的代际，而名单没有加入计数可以判断最后一个何时离开，因此整棵子树一直挂到进程结束。代价按代际计而非按会话计，但并非为零：`dsh-skill-filesystem` 默认监听自己的根目录，因此每一轮「编辑后建会话」都会新增一套活的 watcher。
- **副本从不被实际挂载以校验**——它与来源逐字节相同，因此磁盘上已坏的来源会产出与来源同样损坏的副本；发现过程的健康检查会在下一次读取名单时把两行都标出来，而不是把失败推迟到会话启动。
- **健康问的是「装没装」，不是「能不能 import」**——发现过程证明组装能以加载器方言解析、由具名行组成，且每一行它能证明会启动的行所引用的包装在 harness 基准之上、或所引用的文件确实存在；它从不 import 任何一个，因此入口文件缺失的包、在 apply 时抛错的插件、以及永远等待某个服务的插件，都仍在第一个会话处失败。`disabled` 是加载器唯一会插值的条目字段，因此在该字段写了表达式的行会被跳过，而不是仅凭文件下判断。
- **副本是会漂移的快照**——升级部署不会更新随附 preset 的副本，本层也没有表达「standard 加一处改动」的 patch 语义；随附集合自己也接受同样的代价——`cordis` 与 `code` 都复制了 `standard` 的完整组装并在此基础上编辑——换来整份组装在一个文件里可读。
- **根目录扫描不做监听**——每次读取都实际访问文件系统，这让名单保持新鲜，但每次 `list()` 会对每个根目录产生一次 `readdir`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：回收被替代的代际

回收被替代的常驻挂载，需要给 `StandingMount` 加上已加入 agent 的计数，在 `mount`/`composeFrom`/`recompose` 中递增、在 agent 的 scope key 消亡时递减——即 `ensureStanding` 处的 `TODO`。子树并非惰性：`dsh-skill-filesystem` 监听自己的根目录，因此未回收的代际会让一套活的 watcher 一直存活到进程结束。

</details>
