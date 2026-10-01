# Agent Note：圆桌打断从被打断的发言者续接

Status: implemented

[English](2026-09-08-roundtable-interruption-resumes-from-speaker.md) | 中文

## Problem

圆桌引擎对每位发言者发一次 `ctx.llm.stream` 请求。`LlmRuntime.stream` 会把被中止的请求归一为终止 `finish` 分块（`reason.kind` 为 `'error'`）而不是抛出，而引擎只在 `catch` 分支里检查 `controller.signal.aborted`——对中止与 provider 失败两种情况都不可达。由此产生两处缺陷。轮内发送的用户消息会中止当前请求，但引擎把该发言者记为「思考后跳过」、跑完剩余队列，之后才把待处理消息应用为从队首开新的一轮；`state-machine.ts` 里的打断契约从未被走到。provider 失败同样被渲染成思考后跳过，把基础设施故障藏在发言者自己的决定背后。

## Decision

`speak` 检查终止分块，`reason.kind === 'error'` 时抛出，于是 provider 失败进入 `runRound` 的 catch，记录一条点名该失败的系统提示并跳过前进。`runRound` 在请求返回后检查 `controller.signal.aborted`，而不只在 catch 里检查：被打断的轮次不记录，待处理用户消息经状态机的打断分支从被打断的发言者续接该轮。`tests/state-machine.spec.ts`（16 例）与 `tests/roundtable.spec.ts`（10 例）固定了这两条行为。

## Alternatives considered

**把中止当作跳过。** 否决：它隐藏了打断，并越过用户想要引导的那位发言者继续推进队列。

**把 provider 失败渲染成「思考后跳过」。** 否决：它把基础设施故障误标为发言者自己的决定，且不给用户任何信号。

**打断后从头重开该轮。** 否决：用户消息已并入共享上下文，R13 契约要求从被打断的发言者续接。

**在同一循环迭代里重新请求被打断的发言者。** 否决：打断以新用户消息到达，该状态转移归 `onUserMessage` 所有；引擎必须退出并让它驱动。

## Consequences

- 打断会取消当前请求、不为该发言者记录轮次，并把用户消息并入上下文后从该发言者续接。
- provider 失败呈现为一条系统提示，桌面继续前进而不是卡住。
- 引擎依赖 `LlmRuntime` 归一后的 finish 分块：若适配器改为抛出而非 finish，仍会进入同一个 catch；但若未来适配器换一种通道报告失败，`speak` 需要同步更新。
