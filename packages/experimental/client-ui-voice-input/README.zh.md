---
description: "录制语音并将可确认的转写文字插入会话草稿。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-voice-input

[English](README.md) | 中文

## 概述

此可选浏览器插件在模型选择器与发送按钮之间添加空心麦克风图标。识别就绪后，点击展开录音栏，显示实际音量以及取消、停止按钮。声波高度低于录音按钮高度。停止后转写到草稿。模型准备在麦克风弹窗内完成；语言选项来自所选 Provider。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

以 profile patch bundle 的形式启用[语音输入 Bundle](../voice-input-bundle/README.zh.md)。识别未就绪时，点击麦克风直接打开同一个安装引导弹窗；“下载并准备”在其中开始安装，缓存检查、正在准备、准备失败或服务断连也都在该弹窗内展示状态、进度或错误详情。缓存完整时不弹引导，也无需重复安装；识别未就绪时不显示麦克风悬停提示。弹窗将焦点移入其中，并将 Tab 切换约束在弹窗内；选择“稍后”或按 Escape 关闭时恢复此前焦点，不改变或提交草稿。准备前，本地 Provider 可展示磁盘、内存与安装时间的估算。准备摘要默认折叠；展开后可查看已完成、当前和未开始的步骤。就绪后点击麦克风，允许访问，再点击停止以转写。取消或 Escape 丢弃录音。识别反馈留在工具栏内部。浏览器麦克风访问需要 HTTPS 或环回地址，以及操作系统权限。

下载或重试前，**模型下载源**提供自动选择及 Host 公布的源。SenseVoice 默认提供 Hugging Face 和 HF-Mirror；固定私有部署仅显示配置的源。手动选择只使用指定源，自动选择沿用提供方的比较与回退策略。当前卡片中的重试会保留选择，不修改部署配置或识别偏好。准备期间不能改源，资源就绪后隐藏源选择器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

原生 MediaRecorder 捕获音频，等待最后一块数据后由 Web Audio 转换为 Host 的 PCM 格式。等待麦克风授权时窗口失焦不会取消采集；录音期间失焦会取消。采集失败立即结束录音界面，并在活动栏内提供重试。取消、失败和插件释放共享同一个资源释放 Promise；插件保留所有权，直到 AudioContext 关闭任务结束。原编辑器选区携带草稿版本：草稿变化时，转写文字保留在麦克风旁，供显式插入或丢弃。切换 Session、录音期间隐藏页面和释放插件会使迟到结果失效并释放轨道。插件拥有的一份准备状态订阅服务于输入框及其渲染的安装引导弹窗。只有输入框注册 Slot；两个视图都不拥有准备任务。不发布运行时不变量伴随模块，因为准备状态来自一份 Host 订阅，录音状态属于一个捕获操作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为录音与准备不进入模型请求；之后的文字由普通用户提交拥有。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 不提供自动发送、常开麦克风、唤醒词、流式字幕或语音合成。“本地”指 Host 所在机器，可能与浏览器所在机器不同。
- 本 fork 未挂载识别偏好界面：在设置卡片接入 `configure()` 之前，所选 Provider 与语言来自组合配置。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
