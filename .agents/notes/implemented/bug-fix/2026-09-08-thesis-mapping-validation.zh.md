# Agent Note：assetOverview 拒绝非映射形态的命题 manifest

Status: implemented

[English](2026-09-08-thesis-mapping-validation.md) | 中文

## Problem

`assetOverview` Remote 的命题读取器解析每份 manifest 时，把任何非空且 `typeof data === 'object'` 的值都当作命题映射接受。YAML 序列也满足该判断，因此顶层是列表的损坏 manifest 会被读成所有字段皆空的映射，渲染成一张空命题卡片。页面的设计是在 `problems` 行里点名数据丢失而不是隐藏它，于是损坏的 manifest 反而消失了。

## Decision

`readOverviewTheses` 同时拒绝数组（`Array.isArray(data)`），把 `thesis "<id>" is not a mapping` 记入 `problems` 并跳过该条；页面把这些 problems 渲染在 tab 之上。`tests/overview.spec.ts` 把序列用例与缺索引、坏 JSON 用例并列固定，因此该守卫是经 Remote 的应答被走到的，而不只在孤立场景里。

## Alternatives considered

**静默跳过损坏的 manifest。** 否决：页面的契约就是点名它读不到的数据。

**对每份 manifest 做完整 schema 校验。** 否决，超出范围：读取器只映射少量可选字符串字段，且已容忍字段缺失；数组是唯一会产出「看起来合理的空卡片」的情况。schema 还会拒绝由更旧或更新版本工具写出的 manifest。

**报告问题但仍渲染该条目。** 否决：没有可渲染的内容——序列的每个字段都是空的，卡片会是空白。

## Consequences

- 序列形态的 manifest 呈现为一条点名的问题且不出卡片；概览的其余部分照常渲染。
- 该守卫仍是形态检查而非 schema：未知字段仍被忽略，字段类型错误的映射仍会读成空字符串。
