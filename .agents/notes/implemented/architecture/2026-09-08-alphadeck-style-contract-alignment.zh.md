# Agent Note：AlphaDeck 界面遵循 ui-theme 样式契约

Status: implemented

[English](2026-09-08-alphadeck-style-contract-alignment.md) | 中文

## Problem

`ui-theme` 的样式门禁对出厂 CSS 强制客户端视觉契约：圆角面必须声明配对的 `corner-shape`，中性 token 实线边框用 0.5px 发丝线，提升面的滚动容器要在抬升层重绑 `--dsh-scrollbar-thumb`/`-hover`。AlphaDeck 新增的 UI 包引入了违反契约的面——七处圆角面缺配对声明、一处中性 token 边框是 1px、两个提升滚动容器缺重绑——于是门禁在这些新包上失败。

## Decision

每个违规面改为符合既有契约：七处补 `corner-shape: round`，1px 中性边框改为 0.5px，两个滚动容器补抬升层重绑。门禁、规则与 token 值均不变；修的是新界面，不是契约。

## Alternatives considered

**为 AlphaDeck 界面放宽门禁。** 否决：契约正是配色与层次尺度保持一致的依据，逐包例外会把它拆散。

**改版这些界面以避开这些模式。** 否决：违规是设计上本就符合契约的面缺少声明，而不是设计错误。

**把声明抽到共享组件里。** 否决，超出范围：这些面分布在五个包中，目前没有圆角卡片或提升滚动区的共享 primitive；抽取本身比对齐声明更大的改动。

## Consequences

- 样式门禁在纳入新包后通过。
- 新界面必须从既有卡片或滚动区复制配对声明；门禁是执行点，失败会点名文件。
