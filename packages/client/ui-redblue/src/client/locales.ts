/** Red/blue prompt editor card dictionaries (namespace `settings.redblue`). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '研究纪律 · 红蓝队提示词',
  blurb: '/rb-check 检查使用的红方（攻击）与蓝方（辩护）提示词。留空即用内置默认；「重置」清空回到默认。',
  redLabel: '红方提示词（攻击）',
  blueLabel: '蓝方提示词（辩护）',
  save: '保存',
  saved: '已保存',
  resetRed: '红方重置',
  resetBlue: '蓝方重置',
  saving: '保存中…',
  error: '保存失败：{message}',
  loadError: '读取失败：{message}',
} satisfies Record<string, string>

/** The settings.redblue namespace key union. */
export type RedblueLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'Research discipline · red/blue prompts',
  blurb: 'The red-team (attack) and blue-team (defense) prompts /rb-check runs on. Empty fields use the built-in defaults; Reset clears back to them.',
  redLabel: 'Red-team prompt (attacker)',
  blueLabel: 'Blue-team prompt (defense)',
  save: 'Save',
  saved: 'Saved',
  resetRed: 'Reset red',
  resetBlue: 'Reset blue',
  saving: 'Saving…',
  error: 'Save failed: {message}',
  loadError: 'Load failed: {message}',
} satisfies Record<RedblueLocaleKey, string>
