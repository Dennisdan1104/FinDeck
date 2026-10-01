# Agent Note: Session 格式经 v2→v3→v4 相邻迁移链升级到 V4

Status: implemented

[English](2026-09-27-session-format-v4-adoption.md) | 中文

## 问题

本 fork 在 `SESSION_FORMAT_VERSION = 2`（[types.ts](../../../../packages/core/session/src/types.ts)）上发布了 Session，并把 V2 无法表达的每个上游事件都通过在 [upstream-event-vocabulary.ts](../../../../packages/core/session/src/upstream-event-vocabulary.ts) 中只读登记事件名的方式接进来，而不是改动格式。停留在 V2 是一项有记录的推荐，而不只是实现现状：UPSTREAM_REPORT.md §5.2 第 4 条曾建议维持 V2 并逐个新事件判定 `ignorable`，0.1.6 架构调研也以方案 A 给出同样建议。

这一立场有两项代价不会因为逐事件登记而变小。

登记让外来日志变得可读，但不产出任何东西。`upstream-event-vocabulary.ts` 中的每个条目都是 log-only，该模块被有意排除在包索引导出之外，本构建也不追加其中任何事件。`system/message`、`developer/message`，以及上游经它们携带的延迟工具 schema，在这里都没有生产方，因此本 fork 能读与会写之间的差距曾随每个上游版本扩大。

同一条代际差距也曾在每次移植上付费。0.1.7 移植撞上 `createSystemMessage` 的参数是本构建消息模型没有的、缺少 `displayReason`、以及录制夹具的正文要经过改动才与被移植代码对应——这些适配工作来自 V2/V4 消息模型差异，而不是来自被移植的功能本身。

## 决策

本 fork 已在上游 V4：`SESSION_FORMAT_VERSION` 为 4，writer 盖上 4，正文读取在既有 v0→v1 与 v1→v2 之后，经同一个构建期静态 catalog 组合两个新的纯迁移边包：`@deepseek-ai/dsh-session-format-v2-to-v3` 与 `@deepseek-ai/dsh-session-format-v3-to-v4`。[已发布 Session 格式在读取正文时通过相邻纯迁移边升级](2026-08-31-released-session-format-migrations.zh.md) 继续拥有迁移如何发布：源代际保留其路径、字节与 inode，只新增一个按版本命名的后继，任何已提交代际都不被移动、覆盖或删除。[Session 日志版本机制](2026-08-10-session-log-version-mechanism.zh.md) 继续拥有何时需要升级版本，以及同版本 `ignorable` 行为。

本记录取代 `UPSTREAM_REPORT.md` §5.2 第 4 条、该调研方案 A，以及 `upstream-event-vocabulary.ts` 中陈述该立场的两处注释块所记录的 V2 立场。

### V4 打通的能力

- **工具定义延迟加载（`defer_loading`）**——工具定义不再以完整 schema 随每次请求传输，而是在模型需要时才加载。挂载数百个工具的 profile 每次调用都能得到这份节省。V2 的 request header 只携带一个已装配的 `tools` 数组，没有表示延迟 schema 集合的字段。
- **会话中途增删工具**——`system/message` 与 `developer/message` 是在指定轮与步上记录工具新增或移除的 surface 事件，其 `headerSeq` 指向定义这些新增的更早 `request/header`。V2 没有表达工具集合变化的 surface 表示，因此会话不重启就无法增减工具。
- **不再冒充 user 消息的工具结果**——工具结果成为 `role: 'tool'` 的一等消息，而不是 user 消息里的 content block；每条消息的 `source` 是由生产者自己声明的短名 kind，而不是一个共享的 plugin 兜底，因此两个生产者不会争用同一个来源 id；`plugin:<名字>` 只在迁移边无法映射某个插件串时作为兜底存活。
- **迁移链对既有日志的修复**——v2→v3 边把 header 中渲染好的系统提示词提升为消息，并重映射本地事件引用、PTC 名字与预设名字；v3→v4 边提升工具结果、改名消息来源、关闭日志本身可证明未完成的 interrupted turn，并补上缺失的 parent catalog 事实。每处改写都落在后继代际；前任保持其字节不变。

### Session 日志中的字符串是已承诺数据

要避免的具体错误，是把 Session 日志里存着的字符串当成可以随读取位置一起改名的代码标识。上游 0.1.6→0.1.7 升级正是通过这类改动破坏了本用户的模型与预设：预设从磁盘目录扫描改为 profile 声明，home 级 `settings.yaml` 改为按 profile 存放，于是只改了查找位置的构建失去了全部模型与预设（session 抢救记录）。

已被某个发布版构建写入的事件类型名、消息或来源 id、预设名或工具名属于已承诺数据。改名只能在后继代际的迁移边内重映射，绝不原地改名；当前构建的读取器在一个名字的重映射边存在之前，必须让它的存储拼写继续可读。`tool/code-dispatch*` 就是现成例子：本构建追加 `tool/ptc-dispatch*`，同时因为已发布 V2 日志携带旧拼写而把改名前的拼写保持为只读登记；在 v2→v3 边之下，这次重映射属于该边冻结的已发布 V2 清单，本构建只追加 `tool/ptc-dispatch*`。

`upstream-event-vocabulary.ts` 仍是没有移植拥有包的名字的临时落点。删除条目要求拥有包自己声明该 `SessionEventMap` 成员，因为成员在多次合并之间必须唯一。

### 版本自洽提交点与回退

迁移链按里程碑施工，M3 与 M4 是当时唯一的版本自洽提交点：两者之间既不提交也不发布。

由此有两点后果。第一，以当前版本推导出的存储路径在每个中间态都是错的：本项目批次 1 中，按版本推导的日志名（`session.v4.jsonl.zstd`）到达了一个运行中的进程，而该会话在磁盘上的日志仍为 V2，该轮随即以该缺失路径上的 `ENOENT` 崩溃。第二，版本切换类改动在到达版本自洽点之前，只针对夹具或隔离的 `DSH_HOME` 验证，绝不用真实会话存储验证。

旧构建读不了以 V4 写入的 Session：`assertVersion` 会拒绝任何版本不等于本构建自身 `SESSION_FORMAT_VERSION` 的已存储 header（[storage-contract.ts](../../../../packages/session/session-persistence/src/storage-contract.ts)）。保留的 v2 与 v3 代际是供检查与复制的证据，不是 downgrade 或自动 fallback 支持——已发布格式政策对保留的低代际也是这么规定的。M3 与 M4 是回退可以返回的唯一两笔提交。

## 后果

本次升级的代价是两个迁移包，加上 `packages/llm` 消息模型重构、`core/session` 事件词表，以及全部消费方对齐到新模型——工作量超过整个 0.1.7 移植，用户已接受。

换来的是：上游功能代码移植时不再需要消息模型适配器；请求路径可以延迟工具 schema；surface 可以承载工具集合变化，并以系统提示词作为其首节点；迁移链修复既有日志中可证明的不一致，而不是背负一份不断增长、本构建永远写不出的只读事件词表。

涉及版本的事实陈述与已发布代际一致：`packages/core/session/src/types.ts` 中的 `SESSION_FORMAT_VERSION`、`upstream-event-vocabulary.ts` 中的只读旧拼写、`docs/subsystems/session.md`、生成的 `docs/persistence-catalog.md`，以及 `UPSTREAM_REPORT.md` 中 §5.2 第 4 条。

## 验证

本 fork 不附带任何门禁。`pnpm run build`（其 `tsc -b` 就是类型检查）与针对真实输入的运行才是正确性的依据。每条迁移边都在隔离的 `DSH_HOME` 下针对已发布夹具日志演练，完整链从一份已发布 V2 夹具一次贯通到当前 V4 产物，并在 M3 与 M4 上跑全量构建。真实用户会话存储不作为验证输入。

## 考虑过的替代方案

- **停留在 V2 并逐个事件判定 `ignorable`**——即被取代的决策。不予采用，因为它到不了工具延迟加载与会话中途增删工具（没有 surface 事件可以承载），让每次上游移植都继续付消息模型适配税，并使本构建永远写不出自己已经能读的事件。
- **只升级版本、不做这两条迁移边**——拒绝已发布 V2 日志，另起全新代际。不予采用：这会丢弃已发布的用户数据，并违背本仓库遵循的已发布格式政策。
- **只采用 V3**——先拿系统提示词的 surface 首节点与信封规范化，把 tool 角色结果与命名空间化来源留到以后。不予采用：`role: 'tool'` 与 `plugin:<名字>` 来源属于 V4，消息模型重构与消费方对齐会被付两次，而工具集合的 surface 仍然不可用。
- **原地改掉已承诺名字**——在旧日志写着 `tool/code-dispatch*` 的地方写 `tool/ptc-dispatch*`，或让读取器相信一份新的 profile 声明。不予采用：这正是已经毁掉本用户模型与预设的那类存储迁移，而且会让已存储日志连写出它的构建都读不了。
- **改写已提交代际而不是发布后继**——已发布格式政策已否决：这会破坏迁移被检验所依据的证据，并让文件名与其内容不一致。
