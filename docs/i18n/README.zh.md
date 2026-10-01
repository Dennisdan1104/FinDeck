# 双语文档

[English](README.md) | 中文

本仓库的文档会被公司内外的人和 agent（智能体）阅读，因此范围内的每篇文档都以英文和简体中文维护。本页定义配对约定、范围与排除规则；[translation-rules.md](translation-rules.zh.md) 定义如何翻译；[terminology.md](terminology.md) 是术语真源。agent 的日常工作遵循 [docs/AGENTS.md](../AGENTS.md) 中的轻量路径。仓库里没有任何东西会检查一组配对，因此下面的约定是编辑判断，评审是唯一的约束手段。

<a id="the-pairing-contract"></a>

## 配对约定

- **两种语言同权。** 一篇文档可以先用任一语言撰写和评审（先写中文的 Agent Note 与先写英文的一样正当），另一侧由它翻译而来。两个文件谁也不高于谁；约束它们的是二者必须说同样的话。
- **一对文档是三个同目录文件。** 英文 `foo.md`、中文 `foo.zh.md`，加一份一致性记录 `foo.i18n.yaml`，都在同一目录。不用语言目录，不用独立翻译仓库，不用中英混排的单文件。配对必须整体合并：PR（Pull Request）永远不会只带一种语言而缺其余两个文件。
- **一致性记录。**`foo.i18n.yaml` 保存两侧文件在上一次被确认「说同样的话」时各自的完整 Git blob hash：

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  ```

  用 blob hash 而不是 commit hash，这样同一处改动里编辑的文件也能算出记录（`git hash-object foo.md`），一致性是纯内容比较。记录的 hash 能还原任一侧上次确认时的确切文本，所以失去同步的配对是「按被改一侧的 diff 最小化地修补另一侧」，从不整篇重译。两侧对齐后，手工把两个当前 blob hash 写进 `foo.i18n.yaml`；那份 YAML diff 就是「确认一致」这个动作本身，可以被评审，也正因如此，一次改动只记录它确实确认过的配对。没有任何东西校验这份记录，因此自上次确认后被编辑过的文件就是与记录不符——这种不符是两次确认之间的正常状态，不是缺陷。同时拥有两侧产物的生成器会自己写这份记录：`docs/module-graph.md` 与其 `.i18n.yaml` 就是一起写出的。
- **语言切换行。** 中文文件一律在 H1 标题后立即以 `[English](foo.md) | 中文` 链回英文。普通撰写的英文文件在同一位置以 `English | [中文](foo.zh.md)` 互链；清单内的生成英文源省略此行，以便与生成器输出逐字节一致。发布到 GitHub 以外位置的 README（例如 PyPI 项目元数据）可以改用指向同一对侧文件的规范 `https://github.com/deepseek-ai/deepseek-harness/blob/master/<repository-path>` URL，使切换行在该位置仍可访问。
- **结构与另一侧一一对应。** 标题深度与顺序、列表类型、有序列表起始编号、列表项数量、表格行列数、保留原样 query/fragment 后缀的语义链接目标，以及逐字节一致的代码块在配对两侧一一对应。相对文档链接的目标属于活跃双语语料时，英文侧使用其 `.md` 路径，中文侧使用其 `.zh.md` 路径。该范围内缺少对侧属于配对完整性错误，不得回退；范围外的目标保留原路径。完整保持规则见 [translation-rules.md](translation-rules.zh.md)。

## 保持配对同步

本仓库没有配对校验器、没有链接与换行检查器，也没有针对 `.i18n.yaml` 的 Git 合并驱动或钩子。同步只靠一条工作规则：**当一次改动编辑了已配对文档的任一侧时，同一个改动在术语指导下直接一次完成对侧文件的更新，并重新记录该配对**，与任何其他「改代码必须同时改文档」的要求一样。

两个分支都记录了同一配对时，这就是一个普通文本冲突。请在内容合并完成后，按合并结果实际具有的 hash 重新写入记录；不要手工从任一侧抄一个 hash 过来。

有两条限制值得说清楚：

- **记录下来的配对意味着有人在这些确切内容上确认了两侧一致，不代表这次确认本身可靠。** 没有任何东西替你比对 hash；而且即便有，检查也只能比对结构：两侧是否在说同样的话、措辞是否准确、术语是否得当、行文是否自然，属于评审者那一半约定，见 [translation-rules.md](translation-rules.zh.md)。重新记录了 hash 但另一侧翻得潦草的配对不得通过评审。
- **局部用心不等于覆盖面。** 仔细读完一组配对，说明不了另外九十组；一次改动若触及共享术语或横切事实，就有责任扫过所有重复该事实的配对。

## 范围与排除

**范围**：根目录 `CONTRIBUTING.md`、`BRAND_GUIDELINES.md`、`SAFETY.md` 与 `SECURITY.md` 文档、除 vendor 源码外的全部 README，以及 `.agents/notes/**`、`docs/**` 与 `python/**` 下的全部活跃文档。匹配 README 时只看文件名且不区分大小写，因此新目录里的 README 无需修改任何清单即自动纳入范围。依赖目录、被忽略的构建产物目录以及冻结的 `.agents/notes/archived/` 目录树只在发现阶段排除，不属于持续演进的翻译源文档。

有经评审的中文对侧的生成英文参考文档和图文档遵循配对规则。生成器仍是英文真源；重新生成任一侧时，该配对的 `.i18n.yaml` 会随之一并改写。Cordis subsystem 区块生成器等同时拥有两侧输出的生成器，会把配对文档路径投影到各自 locale，同时保持其余生成字节一致。生成的英文源文件不含普通撰写文档所带的语言切换行，因为添加该行会使生成器输出变陈旧；中文对侧仍链接回英文源。生成页的中文对侧只能改写若直译便不再符合经评审译文事实的自指生成与维护说明；所有技术内容仍受普通忠实性规则约束。

**排除**（永不配对；为它们建 `.zh.md` 或 `.i18n.yaml` 本身就是错误，本清单就是这些文件的记录）：

- [cordis-api/inherited.md](../cordis-api/inherited.md)：该生成文档没有经评审的中文对侧，因此网站的两个 locale 都投影英文源文件。
- `docs/AGENTS.md`、`.agents/notes/**/AGENTS.md` 以及指向它们的 `CLAUDE.md` 指令符号链接：agent 指令，与根 `AGENTS.md` 一样只以英文维护。
- `docs/i18n/terminology.md` 与 [style-samples.md](style-samples.md)：二者本身即为中英对照文档。
- [translation-prompt.md](translation-prompt.md)：提示词模板，其正文是逐字的英文指令文本，同样属于中英对照构造。
- `.agents/notes/archived/`：冻结的历史三文件配对。翻译维护绝不能重写这些文件。

**统一要求**：当前及今后纳入范围的每篇文档，合并时都必须构成完整的双语配对。[scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) 以数据形式保存排除清单，因为 Cordis 目录生成器会读它来把配对文档链接投影到各自 locale。`.agents/notes/archived/` 下的记录保持封存时的原样，头与 hash 都不动。不存在逐文件推进清单、日期分界或 README 专用政策类别。

## 分工

对侧文件由负责处理的 agent 先加载 [terminology.md](terminology.md)，再直接一次性更新；它不会调用翻译 skill（技能）、生成简报、执行单独的翻译评审轮次，也不会委派给 subagent。机器判断不了的部分全归评审：翻译质量、术语，以及上面那些形状规则未涵盖的结构保持。[translation-prompt.md](translation-prompt.md) 保存经人工校准的提示词模板，含 few-shot 示例与三段式输出格式，供需要经模型翻译时使用。
