# Agent Note: 生成的第三方声明

Status: implemented

[English](2026-07-30-generated-third-party-notices.md) | 中文

## 问题

本仓库开源需要披露所依赖的第三方软件及各自的许可证。这份披露必须完整，必须随依赖变化保持为真，还必须给出读者用得上的信息：哪些包最终会进到用户机器上，哪些只用于构建和测试。

手写清单无法长期满足其中任何一条。约一百行从各 manifest（元数据清单）推导出来的包名与许可证标识，只要有依赖新增、移除或换用许可证就会悄悄失真，而没有任何检查会察觉。

## 决策

[`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md) 由 [`scripts/gen-third-party-notices.ts`](../../../../scripts/gen-third-party-notices.ts) 依据各工作区 manifest、`vendor/README.md`、`pyproject.toml` 与 `pnpm-workspace.yaml` 生成。根 README 双语两侧都从「许可证」一节链到该文件。

**新鲜度靠在同一改动中重跑生成器来维持。** manifest、`pnpm-workspace.yaml`、根锁文件、`vendor/README.md`、`python/*/pyproject.toml` 或生成器自身发生改动时，都要跑一次 `pnpm run gen-third-party-notices`，未重跑的已提交副本则由 `pnpm run gen-third-party-notices --check` 报告。这两条命令都不会自动运行。

文件默认只披露**直接**依赖。完整的 npm 闭包连同锁定版本已记录在 `pnpm-lock.yaml`（`pnpm licenses list` 可渲染），Python 闭包记录在 `python/sdk/uv.lock`；再用散文誊一遍只会得到一份更差的副本。唯一明确披露的传递依赖，是 `@anthropic-ai/claude-agent-sdk` 通过 `optionalDependencies` 声明的官方 Claude 平台载荷集合，因为这些包承载随产品分发的 Claude Code 可执行文件，而非普通的库实现细节。

**分层依据是声明方所在区域，而非 manifest 字段名。** 只要 `DEV_ONLY_AREAS` 之外的任一 manifest——即根 manifest、`packages/test-support/`、`packages/test-support/client-runtime/`、`website/`、`native/` 之外——在 `dependencies` 或 `optionalDependencies` 里点名某个包，它就是运行时依赖。单看字段名在两个方向上都会出错：测试支撑包把 `vitest` 写在 `dependencies` 里却并不交付它；而根目录的源码运行脚本通过 `tsx` 执行，根本没有任何 manifest 把它声明为运行时依赖，只能由生成器显式标记。

运行时层刻意覆盖**所有可挂载的插件**，而不止 CLI、Web UI 与 Python 运行时默认加载的那些。从源码运行时，用户可以通过 `cordis.yml` 挂载任何插件包；因此，`@modelcontextprotocol/sdk` 与 OpenTelemetry 系列即使没有任何默认装配引入，也会触达真实用户。对法务披露而言，披露不足才是代价更高的那个方向。

manifest 集合由根 `pnpm-workspace.yaml` 声明的 `packages:` 成员派生，其中包括 Landlock 工作区及其公开包，因此新增成员区域在声明当天就会被读取，而不必等谁想起来去补一份列表。许可证与仓库地址取自根工作区已安装的 pnpm store 和包本地链接场；某个包两处都解析不到时直接失败，而不是留下空单元格。`OVERRIDES` 收录已发布 manifest 答不上来的包：用 Rust 构建、发布时省略 `license` 字段的 npm 可执行包，以及 `modelcontextprotocol/servers` 系列——该仓库正处在 MIT 向 Apache-2.0 的重新许可过程中，实际条款按贡献逐条而定。运行时依赖的许可证若不在宽松清单内即为硬失败：交付 copyleft 是一项分发决策，不该被一次重新生成悄悄吸收。被源码收编的包会与 `vendor/README.md` 交叉核对，出现非 MIT 即报错；`pnpm-workspace.yaml` 的 `patchedDependencies` 列入运行时表格，因为 pnpm 在安装期就会打上这些补丁——交付产物携带的是改动过的 `@earendil-works/pi-tui` 与 `node-pty`，补丁文件本身就是改动的完整记录。

项目所有者另行授权分发每个官方 `@anthropic-ai/claude-agent-sdk` 版本，以及该版本通过 `optionalDependencies` 声明的官方 Claude Code CLI 与平台载荷。生成器将其表示为一项精确匹配直接包身份的例外，而非宽松许可证覆盖项：`SEE LICENSE IN README.md` 与 `SEE LICENSE IN LICENSE.md` 仍归类为非宽松，所有无关的非宽松运行时依赖仍以默认拒绝方式失败。存在该 SDK 时，生成器会读取其已安装 manifest，拒绝不符合官方 SDK 载荷前缀的可选包身份，推导当前 SDK、CLI 与载荷版本，核验已安装宿主载荷的身份、版本和声明许可证字段，并在单独的声明章节中渲染 SDK 声明的完整载荷集合。版本、声明许可证和载荷集合发生变化时无需新的身份授权，但仍须经过常规的依赖、锁文件、兼容性、条款和声明评审。

项目所有者还在 2026-10-01 接受了 MPL-2.0 的 Office 引擎 `@deepseek-ai/libreoffice-kit` 作为运行时依赖：Office 渲染链路原样依赖已发布的包、不修改其源码，因此弱 copyleft 条款的代价，不过是 notices 与已安装包本就携带的署名和许可证文本。生成器以相同方式登记这项接受——`isOwnerAuthorizedRuntime` 接纳的一个精确包身份——并在运行时表格旁渲染一句话。该许可证仍归类为非宽松；依赖的身份、许可证或用法一旦变化，仍须经过常规的依赖、锁文件、兼容性、条款和声明评审。

## 测试

`pnpm run gen-third-party-notices` 依据已安装的依赖树重写 [`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md)；输入不变时再跑一次会写出相同的字节；`pnpm run gen-third-party-notices --check` 只重新渲染、不写入，并在已提交副本不一致时以非零状态退出。渲染本身就是唯一的校验：许可证或仓库地址解析不到、`vendor/README.md` 的表不再覆盖某个收编目录、收编包不是 MIT、`pyproject.toml` 出现不支持的依赖写法或表结构、运行时许可证不在宽松清单内且其精确身份没有所有者授权、已安装的 Claude SDK 声明载荷缺失或与之不符——这些都会让渲染失败，而不是少渲染一行。

依赖、分层或授权类改动以重新生成产物的 diff 为证：新增与移除的行、其所属层，以及运行时表格旁渲染的任何语句。被接受的身份以精确包名出现，其许可证仍归类为非宽松；因此 Claude SDK 身份、其可选载荷集合与被接受的 MPL-2.0 Office 引擎都可以通过读产物完成评审。

## 考虑过的替代方案

**保留手写文件，发版时人工过一遍。** 用肉眼审阅上百行推导数据，恰恰是生成器能做对的活；而且在两次发版之间，文件自称「列出全部直接依赖」这句话无人验证。

**用专门的 `doc-sync`（文档同步门禁）校验。** 单独的门禁要占用一个进程，而它唯一特有的失败方式，就是在别人推完一个无关的依赖升级几分钟后，通知对方回去重跑一次生成器。在同一改动中重跑生成器，就能让文件保持为真，无需靠门禁报告漂移。

**列出完整传递闭包。** 闭包有数千个包，锁文件里已带精确版本，铺开只会淹没读者真正要评估的直接依赖。文件转而指向锁文件与 `pnpm licenses list`。

**按 manifest 字段分层（`dependencies` 与 `devDependencies`）。** 机械上最省事，但在真实数据上两个方向都会出错，理由见上文分层段落。

**只按已交付装配的可达性分层**（`apps/*` 加 `python/sdk-runtime`）。这样得到的运行时层更紧凑，但会把 MCP 客户端与 OpenTelemetry 导出器判为仅开发用途——而运行已安装仓库的用户完全可以挂载它们。这会低估披露，对法务通告来说错在了更危险的一侧。

**将非宽松运行时条款视为宽松条款，或新增可复用的许可证允许列表。** 两种方案都会误述上游声明，并让无关运行时依赖继承从未授予它的授权。这些窄例外只匹配精确的包身份——官方直接 SDK 身份与被接受的 MPL-2.0 Office 引擎；SDK 的可选载荷身份仅作为该 SDK 声明的数据被接受，而每一项被接受的身份都继续明确归类为非宽松。

**把披露文件做成双语对。** 其他根文档都是成对的，但这份文件是上游包名、SPDX 标识与网址构成的表格，可翻译的只有寥寥几段章节导语。`scripts/translation-pairing.ts` 的发现范围限定在 `README*`、`.agents/notes/**`、`docs/**` 与 `python/**`，根目录下的非 README 文件在构造上就不属于双语语料；双语入口由 README 对承担。

## 后果

依赖发生改动时，重新生成的披露文件会随同一个提交入库，代价是改到生成器输入时多跑一次生成器——约一秒。其余改动不付任何代价，漏跑只有等到有人跑一次校验时才会暴露。

生成器需要已安装的依赖树，因此比纯源码生成器更重；发布元数据不可用的新包需要补一条 `OVERRIDES`，而不是默默渲染出空白许可证。这两类失败都会明确报错并指出补救方式。

分层规则是编码在一个常量里的策略。若新增了不参与交付的工作区区域——第二层测试基础设施、另一个站点——就要同步扩展 `DEV_ONLY_AREAS`，否则其依赖会被当作运行时依赖披露出去。

Claude 身份例外刻意比其启用的载荷披露范围更窄。升级 SDK 无需新的所有者授权，但如果已安装的 SDK 未公开自身版本、CLI 版本和至少一个官方平台载荷，或当前宿主载荷与 SDK 声明不符，重新生成就会失败。维护者仍须评审发生变化的条款与兼容性；生成器会阻止授权悄然扩大到其他包。
