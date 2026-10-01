# Agent Note: Implemented-note links to removed upstream workflows

Status: implemented

[English](2026-09-08-implemented-note-removed-workflow-links.md) | 中文

## Problem

`verify-md-links` 检查每个仓库自著 Markdown 文件的相对链接，且只豁免 archived note 的出站链接，因为那段历史已冻结。implemented Agent Note 仍在检查范围内：它们必须跟随其决策所在的位置。本 fork 删除了继承自上游的 `.github/workflows` 目录，因此十对 implemented note 仍链接到 `ci.yml`、`ci-master.yml`、`e2e.yml`、`sandbox.yml`、`issue-policy.yml`、`issue-lifecycle.yml` 与 `build-exe-for-python-sdk.yml`——44 条链接指向 fork 有意删除的文件。该门禁没有忽略清单，于是每次 doc-sync 都失败。

## Decision

`verify-md-links` 只豁免一种历史情况：来源位于 `.agents/notes/implemented/` 之下，且链接目标匹配 `.github/workflows/<file>.yml|yaml` 却不存在。`isRemovedUpstreamWorkflowReference` 实现该规则，`findViolations` 仅在目标缺失分支中应用它，因此存在的目标仍会做锚点检查，其他缺失目标仍然失败。门禁的模块文档写明了该豁免。

## Alternatives considered

**改写 note 里的链接。** 否决：这些 note 记录的决策其证据就是那个 workflow 文件，且其正文仍在描述已删除的 CI 布局；改写链接改变了历史记录，却没有让正文变成事实。

**删除链接。** 否决：这会删掉决策所引用的证据，并让前后句子悬空。

**恢复 workflow 文件。** 否决：fork 是有意删除它们的；为满足链接检查器而恢复 CI 文件颠倒了依赖方向。

**豁免 implemented note 的全部链接。** 否决：这会让 note 完全不再受检查，并掩盖指向当前文件的真实坏链。

**把 archived note 的豁免扩大到 implemented note。** 同因否决：implemented note 必须随代码移动跟踪当前路径。

## Consequences

- 那 44 条链接作为历史成立，`verify-md-links` 在检查 2302 个文件后通过。
- note 链接到缺失的非 workflow 文件、或非 note 文档链接到缺失的 workflow，仍然失败；`scripts/verify-md-links.spec.ts` 固定了这两种拒绝与豁免本身。
- 豁免按目录与扩展名限定：存在的 workflow 文件仍受检查，note 链接到缺失的 `.github/workflows/*.md` 仍会失败。
