/** `settings.systemPrompt` dictionaries (the System-prompt personalization editor's copy, title included as the page label). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '系统提示词',
  'description': '这里填写的个人化内容会拼入系统提示词，从下一个模型步骤起对全部会话生效。',
  'personaPrefix.label': '人格前缀',
  'personaPrefix.hint': '排在第一方指导之前，用来设定助手的身份与口吻。',
  'personaSuffix.label': '人格后缀',
  'personaSuffix.hint': '排在第一方指导之后，用于补充环境相关的说明。',
  'customInstructions.label': '自定义指令',
  'customInstructions.hint': '追加到系统提示词的末尾，用来放置你固定的要求。',
  'save': '保存',
  'saving': '保存中',
  'saved': '已保存',
  'readOnly': '当前设置的存储不可写，修改不会被保存。',
  'saveError': '保存失败：{message}',
} satisfies Record<string, string>

/** The settings.systemPrompt namespace key union. */
export type PersonaKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'System prompt',
  'description': 'What you write here is composed into the system prompt, and reaches every session from the next model step.',
  'personaPrefix.label': 'Persona prefix',
  'personaPrefix.hint': 'Rendered before first-party guidance; sets the assistant’s identity and voice.',
  'personaSuffix.label': 'Persona suffix',
  'personaSuffix.hint': 'Rendered after first-party guidance, alongside the environment facts.',
  'customInstructions.label': 'Custom instructions',
  'customInstructions.hint': 'Appended at the very end of the system prompt for your standing requirements.',
  'save': 'Save',
  'saving': 'Saving',
  'saved': 'Saved',
  'readOnly': 'The settings store is read-only, so changes are not saved.',
  'saveError': 'Save failed: {message}',
} satisfies Record<PersonaKey, string>
