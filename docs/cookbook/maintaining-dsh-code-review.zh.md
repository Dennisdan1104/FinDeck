# 本 fork 的代码评审

[English](maintaining-dsh-code-review.md) | 中文

本 fork 不带 `dsh-code-review` skill（技能），也不带 skill 维护工作流。周期性挖掘评审反馈的工具、它的评审适配器、晋级辅助命令，以及运行它们的机器，都是本仓库之外的私有基础设施，在这里没有对应物，因此既没有待晋级的候选 diff，也没有操作员手册可循。

一次改动的评审依据，就是贡献者本身要读的那些文档：所属包 README 承载其约定，[docs/AGENTS.md](../AGENTS.md) 规定文档结构与行文规则，所属[子系统页面](../subsystems/README.zh.md)承载类型层面的事实。评审者对着这些文档、对着真实运行的产品读 diff，而不是对着一张检查清单。
