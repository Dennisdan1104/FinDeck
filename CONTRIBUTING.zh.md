# 贡献

[English](CONTRIBUTING.md) | 中文

感谢你愿意为 FinDeck 作出贡献。

FinDeck 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork——一个"一切皆插件"的 agent 运行时——并在其上叠加了一层金融研究能力。欢迎提 issue 和 PR（Pull Request）。本 fork 只有一位维护者，因此较大的改动请先开 issue：先就方向达成一致，再让代码出现。

## 各类内容的去处

- **bug 与功能建议** —— 开 [GitHub issue](https://github.com/Dennisdan1104/FinDeck/issues)。写清你运行的命令、实际发生了什么、你期望发生什么；别人能从全新 clone 复现的失败，会最先被修。
- **安全漏洞** —— 绝不要开公开 issue。请按 [SECURITY.zh.md](SECURITY.zh.md) 走 GitHub 私有漏洞报告。
- **PR** —— 针对 `master` 提交，一个 PR 只做一件事，并说明你实际跑通了哪条路径、读到了什么结果。你贡献的代码按本项目发布的 [MIT 许可证](LICENSE) 接受。
- **插件与 skill** —— 本仓库之外的包是扩展 FinDeck 的一等方式：任何写在 `cordis.yml` 里的包都会在加载时被挂载，插件不必合并进本仓库才能用。

## 开发环境

FinDeck 基于 Node.js ≥ 22.19（或 ≥ 24）与 pnpm 11.7 构建。金融能力层额外需要 Python ≥ 3.10，环境由 [`finance/python/setup-env.sh`](finance/python/setup-env.sh) 创建（Windows 用 `finance/python/setup-env.ps1`）；金融 skill 之外的代码不需要它。Windows 是主要开发平台，同样的命令在 macOS 与 Linux 上可用。

```sh
git clone https://github.com/Dennisdan1104/FinDeck.git findeck
cd findeck
pnpm install
pnpm run build
```

## 变更如何验证

本 fork 不带测试运行器，也不带 CI 门禁：仓库中留有约三十个历史 spec 与端到端测试文件，但没有任何东西执行它们；此外没有覆盖率或 lint 门禁、没有 `test`／`check`／`verify` 脚本，也没有任何会自己变红的东西。一个改动被接受，是因为它被构建过、并用真实输入跑通了受影响路径，而不是因为有检查器变绿（[验证](docs/testing.zh.md)）。

```sh
pnpm run build
```

构建同时也是唯一的类型检查——`build:lib:host` 会运行 `tsc -b tsconfig.host.json`，类型错误会让它失败。除此之外，验收就是真实跑一遍你改动的路径——`pnpm run dev`、`pnpm dsh --profile headless "…"`、Web UI 或 Python SDK——然后读回持久结果：写出的文件、session 日志、工作区或渲染出的页面。你自己对代码该做什么的总结不是证据；请从外部重新读一遍输出。

不要给本 fork 加门禁。引入测试运行器、lint 或覆盖率步骤、pre-push hook 或 CI workflow 的 PR 超出本仓库范围，依据见 [AGENTS.md](AGENTS.md) 的固定要求。

## 文档

文档是双语的：每一份在范围内的文档都是三件套——英文 `foo.md`、中文 `foo.zh.md`，以及一致性记录 `foo.i18n.yaml`。两种语言地位相同，因此改动任一侧时，要在同一次改动里把对侧一并带上，绝不留给后续。

记录里存放两侧在最近一次确认一致时的 git blob hash：

```sh
git hash-object foo.md foo.zh.md
```

把两个 hash 写进 `foo.i18n.yaml`；这个 diff 就是确认配对的动作。没有任何东西校验这份记录，完整约定见 [docs/i18n/README.zh.md](docs/i18n/README.zh.md)。

## Agent Note

改动如果触及行为、架构、跨包的契约、流程或工具链，或者磁盘、wire、配置文件格式，就值得在同一次改动里写一份 Agent Note：记录为什么这么做、放弃了什么。纯机械或局部的编辑不需要。

Agent Note 位于 `.agents/notes/{proposed|implemented|rejected}/{class}/yyyy-mm-dd-topic-title.md`，必须带 `## Problem` 与 `## Alternatives considered` 两节，并且与其它文档一样是英文／中文／sidecar 三件套。格式、类别清单与归档规则见 [.agents/notes/README.zh.md](.agents/notes/README.zh.md)。
