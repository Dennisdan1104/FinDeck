# Agent Note: AlphaDeck 解析自己的 home 目录

Status: implemented

[English](2026-09-11-alphadeck-separate-home-directory.md) | 中文

## 问题

AlphaDeck 与原版 DeepSeek Harness 并存安装，并且预期两者可以同时运行。两者的用户数据都经同一条 harness home 解析器解析，而该解析器的默认目录名是 `.dsh`（见[单一 harness home 解析器](2026-07-24-single-harness-home-resolver.zh.md)）。共用该根目录会让两个产品落在同一份会话存储、同一个 `settings.yaml`、同一个 `.credentials.yaml` 和同一棵 `profiles/` 上：任一方改设置或写凭据，另一方都看得见、也可能被弄坏，而且两个产品都无法独立升级或重置。

这次分歧也没有留下记录。读 `@deepseek-ai/dsh-home-paths` 的人会看到：读到 `.alphadeck` 的那个常量，周围的文字写的却是 `~/.dsh`，因此无法判断这个值是刻意的还是改漏了。

## 决策

`DSH_HOME_DIR_NAME` 取 `.alphadeck`，因此默认的 AlphaDeck home 是 `~/.alphadeck`。优先级归 `@deepseek-ai/dsh-home-paths` 所有：显式配置路径，其次 `$ALPHADECK_HOME`，再次 `$DSH_HOME`，最后 `~/.alphadeck`。解析为原版 home `~/.dsh` 的 `$DSH_HOME` 会被拒绝，并在每个进程打印一次提示：原版会把它自己的这个值导出给每个它启动的 shell，若照单全收，从原版终端（或运行在原版里的 agent）拉起的 AlphaDeck 服务就会在没人选择的情况下塌缩到另一个产品的根目录上。要刻意共用该目录，请设 `$ALPHADECK_HOME`。`dshHomeDisplay()` 分别对三者报告 `~/.alphadeck`、`$ALPHADECK_HOME`、`$DSH_HOME`。

AlphaDeck 的每一处用户数据位置都经 `resolveDshHome()` 或 `dshHomePath()` 解析。资产库、命题登记表、web-app 资产总览和默认工作区都从该接缝派生路径，而不是各自重复目录名。

两个产品在网络上也分开：AlphaDeck 服务在 3081 端口，原版 DeepSeek Harness 服务在 3080。3081 端口归 `start-alphadeck.ps1`：它把 `$ALPHADECK_HOME` 和 `$DSH_HOME` 设为 `~/.alphadeck`，把服务进程号记在 `~/.alphadeck/logs/web-server.pid`，并替换该端口上不是它自己启动的服务——所以“串味”的实例只要重跑一次启动脚本就会被纠正。

## 备选方案

**保留 `~/.dsh`，靠 `$DSH_HOME` 实现并存。** 否决：同时运行两个产品是本 fork 用户的常规用法，而共用 home 不是外观层面的冲突——会话、设置与凭据会互相交织。要求用户在第二个产品首次运行前先设环境变量，等于把默认路径变成一次配置故障。

**首次运行时把 `~/.dsh` 复制或迁移到 `~/.alphadeck`。** 否决：本 fork 不得移动、改写或删除另一个安装的用户数据。复制会把会话与凭据悄悄分叉成两份此后各自演进的存储，而 AlphaDeck 无从得知用户想继续使用哪个安装。

**保留共用 home，把 AlphaDeck 的文件在其中命名空间化。** 否决：会话、设置、凭据与 profile 都以 home 根为基准，命名空间化就得触及解析器的每一个消费方，其中包含本 fork 并不拥有的上游包。

## 影响

- 原版 DeepSeek Harness 安装与 AlphaDeck 各自拥有独立的会话、设置、凭据、profile 与附件对象，两者可同时运行。
- 指向原版 home 的 `$DSH_HOME` 不再能搬迁 AlphaDeck，因此这份隔离不取决于服务是怎么被拉起来的。确实想共用该目录的用户设 `$ALPHADECK_HOME`。
- 已经存放在 `~/.dsh` 下的数据不会出现在 AlphaDeck 中。不存在迁移路径；想沿用上游历史的用户必须把 `$DSH_HOME` 指向那棵树，或自行刻意复制。
- 任何硬编码 `~/.alphadeck` 而不调用解析器的用户数据路径，都会不再跟随已配置的 home 或 `$DSH_HOME`。共享根与其优先级仍归解析器决定，不属于各个消费方。
- 上游文档与 Agent Note 中把默认 home 写作 `~/.dsh` 的地方，凡是描述 AlphaDeck 自身行为的，在本 fork 中都已过时。
