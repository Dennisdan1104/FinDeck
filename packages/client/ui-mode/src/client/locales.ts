/** `mode` namespace dictionaries (the mode control and flow strip's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'select.hint': '切换会话模式',
  'select.switchFailed': '切换模式失败',
  'select.alreadyOwned': '这个会话正在另一个窗口或服务实例中打开，暂时无法切换模式。关闭另一个实例后重试。',
  'select.kindWork': '工作',
  'select.kindFree': '自由',
  'select.projectBadge': '项目',
  'input.cluster': 'AI 集群',
  'input.clusterTurnOn': '开启本会话的 AI 集群',
  'input.clusterTurnOff': '关闭本会话的 AI 集群',
  'input.clusterFailed': '切换 AI 集群失败',
  'bar.free': '自由模式',
  'bar.trail': '轨迹：{steps}',
  'bar.current': '当前：{label}',
  'bar.model': '模型：{model}',
  'bar.cluster': '集群',
} satisfies Record<string, string>

/** The mode namespace key union. */
export type ModeUiKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'select.hint': 'Switch the session mode',
  'select.switchFailed': 'Failed to switch mode',
  'select.alreadyOwned': 'This session is open in another window or harness instance, so the mode cannot be switched yet. Close the other instance and retry.',
  'select.kindWork': 'work',
  'select.kindFree': 'free',
  'select.projectBadge': 'project',
  'input.cluster': 'AI cluster',
  'input.clusterTurnOn': 'Turn on the AI cluster for this session',
  'input.clusterTurnOff': 'Turn off the AI cluster for this session',
  'input.clusterFailed': 'Failed to switch the AI cluster',
  'bar.free': 'Free mode',
  'bar.trail': 'Trail: {steps}',
  'bar.current': 'Current: {label}',
  'bar.model': 'Model: {model}',
  'bar.cluster': 'cluster',
} satisfies Record<ModeUiKey, string>
