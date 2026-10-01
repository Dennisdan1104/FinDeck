# Agent Note：新包经 tsconfig 路径别名解析

Status: implemented

[English](2026-09-08-new-package-tsconfig-aliases.md) | 中文

## Problem

AlphaDeck 新增的六个包——`dsh-tool-thesis`、`dsh-redblue`、`dsh-roundtable`、`dsh-client-ui-assets`、`dsh-client-ui-redblue` 与 `dsh-client-ui-roundtable`——在生成的 `tsconfig.base.json` 中没有 `paths` 别名（`dsh-client-ui-shell` 的 client 面也没有）。因此工作区导入经 `node_modules` 落到各包已构建的 `lib/`，测试与类型检查读的是构建产物而非源码。这与源码面规则相反，并造成一个陷阱：改包源码在重建之前毫无效果。工具目录同样还没有 tool-thesis 的三个工具。

## Decision

`gen-tsconfig-paths` 为六个包补齐别名（声明了 client 面的包两面都补），并重新生成 `tsconfig.base.json`；`gen-tool-catalog` 登记 `thesis_list`/`thesis_write`/`thesis_mark` 并重新生成 `docs/tool-catalog.md`。`verify-tsconfig-paths` 与 `verify-tool-catalog` 通过。

## Alternatives considered

**只依赖各包自己的 tsconfig。** 否决：仓库门禁与 Vitest 都经 `tsconfig.base.json` 解析；没有基类别名就会回落到构建产物。

**手工编辑 `tsconfig.base.json`。** 否决：该文件是生成的，`verify-tsconfig-paths` 会报漂移；生成器是唯一所有者。

**刻意把别名指向 `lib/`。** 否决：这会让门禁测试构建产物，正是本次要修的缺陷。

## Consequences

- 六个包的测试与类型检查读 `src`；改源码无需重建即生效。
- 工具目录列出 tool-thesis 的 schema，别名表与目录由同一个生成器负责。
- 未来新增的包在补齐别名之前对源码面不可见；`verify-tsconfig-paths` 是执行点。
