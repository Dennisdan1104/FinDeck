/**
 * Curated plugin catalog: the plugin page's one table mapping a shipped
 * module to its display group and locale key for the one-line description.
 * Keys are `moduleShortName` outputs; entries absent from this table render
 * in the platform group with their module name only.
 *
 * A row may also mark its module as user-managed (`managed: true`) and give it
 * a display name. The plugin page lists user-managed modules as switchable
 * cards above the collapsed system region, so the flag is the page's whole
 * user/system split.
 */

import type { PluginInventoryLocaleKey } from './locales.ts'

/** Display group of one plugin card on the plugin page. */
export type PluginGroupKind = 'capability' | 'data' | 'interface' | 'platform'

/** Render order of the global plane's groups. */
export const PLUGIN_GROUP_ORDER = ['capability', 'data', 'interface', 'platform'] as const

/** Locale key naming one group in the dictionaries. */
export const PLUGIN_GROUP_KEYS: Record<PluginGroupKind, PluginInventoryLocaleKey> = {
  capability: 'groupCapability',
  data: 'groupData',
  interface: 'groupInterface',
  platform: 'groupPlatform',
}

/** One cataloged plugin's group, description, and user-managed facts. */
export interface PluginCatalogRow {
  readonly group: PluginGroupKind
  readonly descriptionKey: PluginInventoryLocaleKey
  /**
   * Whether the user owns this plugin: the page lists it as a switchable card
   * above the system region instead of inside the collapsed inventory.
   *
   * The criterion is optional user-facing capability: the harness boots and
   * serves without it, disabling it degrades only the feature it provides, and
   * the same card reverses the decision. Transport, session, settings,
   * sandbox, prompt, and shell plugins are load-bearing and stay system.
   */
  readonly managed?: boolean
  /** Card name for a managed row; absent rows fall back to the module name. */
  readonly nameKey?: PluginInventoryLocaleKey
}

/** Group for a module the catalog does not name. */
export const UNCATALOGED_GROUP: PluginGroupKind = 'platform'

/** Curated module-name → group/description rows for the plugin inventory cards. */
export const PLUGIN_CATALOG: Record<string, PluginCatalogRow> = {
  // ── Capability: what the agent can do ──
  'agent': { group: 'capability', descriptionKey: 'descAgent' },
  'agent-loop': { group: 'capability', descriptionKey: 'descAgentLoop' },
  'agent-instructions': { group: 'capability', descriptionKey: 'descAgentInstructions' },
  'agent-presets': { group: 'capability', descriptionKey: 'descAgentPresets' },
  'persona': { group: 'capability', descriptionKey: 'descPersona' },
  'system-prompt': { group: 'capability', descriptionKey: 'descSystemPrompt' },
  'mode': { group: 'capability', descriptionKey: 'descMode' },
  'plan-mode': { group: 'capability', descriptionKey: 'descPlanMode' },
  'goal': { group: 'capability', descriptionKey: 'descGoal' },
  'goal-round-driver': { group: 'capability', descriptionKey: 'descGoalRoundDriver' },
  'command-goal': { group: 'capability', descriptionKey: 'descCommandGoal' },
  'tool-goal': { group: 'capability', descriptionKey: 'descToolGoal' },
  'commands': { group: 'capability', descriptionKey: 'descCommands' },
  'command-compact': { group: 'capability', descriptionKey: 'descCommandCompact' },
  'command-feedback': { group: 'capability', descriptionKey: 'descCommandFeedback' },
  'tools': { group: 'capability', descriptionKey: 'descTools' },
  'tool-bash': { group: 'capability', descriptionKey: 'descToolBash' },
  'tool-pwsh': { group: 'capability', descriptionKey: 'descToolPwsh' },
  'tool-fs': { group: 'capability', descriptionKey: 'descToolFs' },
  'tool-str-replace-editor': { group: 'capability', descriptionKey: 'descToolStrReplaceEditor' },
  'tool-fs-search': { group: 'capability', descriptionKey: 'descToolFsSearch' },
  'tool-jobs': { group: 'capability', descriptionKey: 'descToolJobs' },
  'tool-skill': { group: 'capability', descriptionKey: 'descToolSkill' },
  'tool-web': { group: 'capability', descriptionKey: 'descToolWeb' },
  'tool-todo': { group: 'capability', descriptionKey: 'descToolTodo' },
  'tool-ask-user': { group: 'capability', descriptionKey: 'descToolAskUser' },
  'tool-subagent': { group: 'capability', descriptionKey: 'descToolSubagent' },
  'tool-subagent-control': { group: 'capability', descriptionKey: 'descToolSubagentControl' },
  'tool-cluster': { group: 'capability', descriptionKey: 'descToolCluster' },
  'tool-subagent/model-selection-settings': { group: 'capability', descriptionKey: 'descSubagentModelSelection' },
  'tool-workflow': { group: 'capability', descriptionKey: 'descToolWorkflow' },
  'tool-ralph': { group: 'capability', descriptionKey: 'descToolRalph' },
  'tool-asset-library': { group: 'capability', descriptionKey: 'descToolAssetLibrary' },
  'subagent': { group: 'capability', descriptionKey: 'descSubagent' },
  'subagent-spawn-in-process': { group: 'capability', descriptionKey: 'descSubagentSpawn' },
  'subagent-fork-in-process': { group: 'capability', descriptionKey: 'descSubagentFork' },
  'workflow-ptc': { group: 'capability', descriptionKey: 'descWorkflowPtc' },
  'ptc-runtime-node': { group: 'capability', descriptionKey: 'descPtcRuntime' },
  'compaction-basic': { group: 'capability', descriptionKey: 'descCompactionBasic' },
  'compaction-tool-result-pruner': { group: 'capability', descriptionKey: 'descCompactionPruner' },
  'skill': { group: 'capability', descriptionKey: 'descSkill' },
  'skill-badge': { group: 'capability', descriptionKey: 'descSkillBadge' },
  'skill-filesystem': { group: 'capability', descriptionKey: 'descSkillFilesystem' },
  'jobs-local': { group: 'capability', descriptionKey: 'descJobsLocal' },
  'user-questions': { group: 'capability', descriptionKey: 'descUserQuestions' },
  'session-title': { group: 'capability', descriptionKey: 'descSessionTitle' },
  'session-title-first-prompt-llm': { group: 'capability', descriptionKey: 'descSessionTitleLlm' },
  'session-reference': { group: 'capability', descriptionKey: 'descSessionReference', managed: true, nameKey: 'nameSessionReference' },
  'repeat-tool-reminder': { group: 'capability', descriptionKey: 'descRepeatToolReminder' },
  'message-feedback': { group: 'capability', descriptionKey: 'descMessageFeedback', managed: true, nameKey: 'nameMessageFeedback' },

  // ── Data: models, sources, and durable state ──
  'llm': { group: 'data', descriptionKey: 'descLlm' },
  'llm-deepseek': { group: 'data', descriptionKey: 'descLlmDeepseek' },
  'llm-pi-ai': { group: 'data', descriptionKey: 'descLlmPiAi' },
  'llm-retry': { group: 'data', descriptionKey: 'descLlmRetry' },
  'deepseek-llm-api-extensions': { group: 'data', descriptionKey: 'descDeepseekExtensions' },
  'agent-default-model': { group: 'data', descriptionKey: 'descAgentDefaultModel' },
  'web': { group: 'data', descriptionKey: 'descWeb' },
  'web-search-deepseek': { group: 'data', descriptionKey: 'descWebSearchDeepseek', managed: true, nameKey: 'nameWebSearch' },
  'web-fetch-http': { group: 'data', descriptionKey: 'descWebFetchHttp', managed: true, nameKey: 'nameWebFetch' },
  'session': { group: 'data', descriptionKey: 'descSession' },
  'session-log-deepseek': { group: 'data', descriptionKey: 'descSessionLogDeepseek' },
  'session-persistence-jsonl': { group: 'data', descriptionKey: 'descSessionPersistence' },
  'session-query-sqlite': { group: 'data', descriptionKey: 'descSessionQuery' },
  'session-projection': { group: 'data', descriptionKey: 'descSessionProjection' },
  'session-projection-cache': { group: 'data', descriptionKey: 'descSessionProjectionCache' },
  'session-checkpoint-policy': { group: 'data', descriptionKey: 'descSessionCheckpointPolicy' },
  'session-telemetry-otel': { group: 'data', descriptionKey: 'descSessionTelemetry', managed: true, nameKey: 'nameSessionTelemetry' },
  'session-log-export': { group: 'data', descriptionKey: 'descSessionLogExport', managed: true, nameKey: 'nameSessionLogExport' },
  'session-stats': { group: 'data', descriptionKey: 'descSessionStats' },
  'session-turn-outline': { group: 'data', descriptionKey: 'descSessionTurnOutline' },
  'storage': { group: 'data', descriptionKey: 'descStorage' },
  'storage-json': { group: 'data', descriptionKey: 'descStorageJson' },
  'storage-domain': { group: 'data', descriptionKey: 'descStorageDomain' },
  'spill-local': { group: 'data', descriptionKey: 'descSpillLocal' },
  'spill-policy': { group: 'data', descriptionKey: 'descSpillPolicy' },
  'attachment-local': { group: 'data', descriptionKey: 'descAttachmentLocal' },
  'credentials-local': { group: 'data', descriptionKey: 'descCredentialsLocal' },
  'settings-file': { group: 'data', descriptionKey: 'descSettingsFile' },
  'workspace': { group: 'data', descriptionKey: 'descWorkspace' },
  'file-reference-local': { group: 'data', descriptionKey: 'descFileReferenceLocal', managed: true, nameKey: 'nameFileReference' },
  'token-meter': { group: 'data', descriptionKey: 'descTokenMeter' },

  // ── Interface: everything the user sees ──
  'webserver': { group: 'interface', descriptionKey: 'descWebserver' },
  'web-app': { group: 'interface', descriptionKey: 'descWebApp' },
  'web-app/startup': { group: 'interface', descriptionKey: 'descWebAppStartup' },
  'api-remotes': { group: 'interface', descriptionKey: 'descApiRemotes' },
  'api-session-controller': { group: 'interface', descriptionKey: 'descApiSessionController' },
  'api-settings-controller': { group: 'interface', descriptionKey: 'descApiSettingsController' },
  'api-workspace-controller': { group: 'interface', descriptionKey: 'descApiWorkspaceController' },
  'client-connection': { group: 'interface', descriptionKey: 'descClientConnection' },
  'client-modules': { group: 'interface', descriptionKey: 'descClientModules' },
  'client-file-upload': { group: 'interface', descriptionKey: 'descClientFileUpload' },
  'locale': { group: 'interface', descriptionKey: 'descLocale' },
  'ui-theme': { group: 'interface', descriptionKey: 'descUiTheme' },
  'ui-shell': { group: 'interface', descriptionKey: 'descUiShell' },
  'ui-layout': { group: 'interface', descriptionKey: 'descUiLayout' },
  'ui-pages': { group: 'interface', descriptionKey: 'descUiPages' },
  'ui-renderer': { group: 'interface', descriptionKey: 'descUiRenderer' },
  'ui-session': { group: 'interface', descriptionKey: 'descUiSession' },
  'ui-sidebar': { group: 'interface', descriptionKey: 'descUiSidebar' },
  'ui-conversation': { group: 'interface', descriptionKey: 'descUiConversation' },
  'ui-chat': { group: 'interface', descriptionKey: 'descUiChat' },
  'ui-mode': { group: 'interface', descriptionKey: 'descUiMode' },
  'ui-plan': { group: 'interface', descriptionKey: 'descUiPlan' },
  'ui-goal': { group: 'interface', descriptionKey: 'descUiGoal' },
  'ui-jobs': { group: 'interface', descriptionKey: 'descUiJobs' },
  'ui-schedule': { group: 'interface', descriptionKey: 'descUiSchedule' },
  'ui-skill': { group: 'interface', descriptionKey: 'descUiSkill' },
  'ui-tool': { group: 'interface', descriptionKey: 'descUiTool' },
  'ui-cordis': { group: 'interface', descriptionKey: 'descUiCordis' },
  'ui-approval': { group: 'interface', descriptionKey: 'descUiApproval' },
  'ui-attachment': { group: 'interface', descriptionKey: 'descUiAttachment' },
  'ui-reference': { group: 'interface', descriptionKey: 'descUiReference' },
  'ui-deliverables': { group: 'interface', descriptionKey: 'descUiDeliverables' },
  'ui-workspace': { group: 'interface', descriptionKey: 'descUiWorkspace' },
  'ui-workflow-run': { group: 'interface', descriptionKey: 'descUiWorkflowRun' },
  'ui-input-trigger': { group: 'interface', descriptionKey: 'descUiInputTrigger' },
  'ui-commands': { group: 'interface', descriptionKey: 'descUiCommands' },
  'ui-subagent': { group: 'interface', descriptionKey: 'descUiSubagent' },
  'ui-message-feedback': { group: 'interface', descriptionKey: 'descUiMessageFeedback' },
  'ui-model-selection': { group: 'interface', descriptionKey: 'descUiModelSelection' },
  'ui-permission-presets': { group: 'interface', descriptionKey: 'descUiPermissionPresets' },
  'ui-agent-preset': { group: 'interface', descriptionKey: 'descUiAgentPreset' },
  'ui-user-questions': { group: 'interface', descriptionKey: 'descUiUserQuestions' },
  'ui-trajectory': { group: 'interface', descriptionKey: 'descUiTrajectory' },
  'ui-settings': { group: 'interface', descriptionKey: 'descUiSettings' },
  'ui-settings-general': { group: 'interface', descriptionKey: 'descUiSettingsGeneral' },
  'ui-settings-models': { group: 'interface', descriptionKey: 'descUiSettingsModels' },
  'ui-settings-plugins': { group: 'interface', descriptionKey: 'descUiSettingsPlugins' },
  'ui-settings-plugin-inventory': { group: 'interface', descriptionKey: 'descUiSettingsPluginInventory' },
  'host-directory-picker-auto': { group: 'interface', descriptionKey: 'descDirectoryPickerAuto' },
  'host-directory-picker-native': { group: 'interface', descriptionKey: 'descDirectoryPickerNative' },
  'ui-directory-picker-native': { group: 'interface', descriptionKey: 'descDirectoryPickerUi' },
  'plugin-inventory': { group: 'interface', descriptionKey: 'descPluginInventory' },

  // ── Platform: runtime infrastructure ──
  'include': { group: 'platform', descriptionKey: 'descInclude' },
  'timer': { group: 'platform', descriptionKey: 'descTimer' },
  'hmr': { group: 'platform', descriptionKey: 'descHmr' },
  'client-hmr': { group: 'platform', descriptionKey: 'descClientHmr' },
  'typert-registry': { group: 'platform', descriptionKey: 'descTypertRegistry' },
  'typert-loader': { group: 'platform', descriptionKey: 'descTypertLoader' },
  'api-gateway': { group: 'platform', descriptionKey: 'descApiGateway' },
  'cordis-host-runner': { group: 'platform', descriptionKey: 'descCordisHostRunner' },
  'cordis-client-runner': { group: 'platform', descriptionKey: 'descCordisClientRunner' },
  'subprocess-local': { group: 'platform', descriptionKey: 'descSubprocessLocal' },
  'sandbox-local': { group: 'platform', descriptionKey: 'descSandboxLocal' },
  'sandbox-policy': { group: 'platform', descriptionKey: 'descSandboxPolicy' },
  'bash-sandbox': { group: 'platform', descriptionKey: 'descBashSandbox' },
  'pwsh-sandbox': { group: 'platform', descriptionKey: 'descPwshSandbox' },
  'fs-sandbox': { group: 'platform', descriptionKey: 'descFsSandbox' },
  'shell-env': { group: 'platform', descriptionKey: 'descShellEnv' },
  'fs-observation-policy': { group: 'platform', descriptionKey: 'descFsObservationPolicy' },
  'tool-call-timeout-policy': { group: 'platform', descriptionKey: 'descToolCallTimeout' },
  'user-approval': { group: 'platform', descriptionKey: 'descUserApproval' },
  'permission-presets': { group: 'platform', descriptionKey: 'descPermissionPresets' },
  'plugin-package-inventory-deepseek': { group: 'platform', descriptionKey: 'descPluginPackageInventory' },
}

/**
 * Look up one module's catalog row, or the platform fallback for it.
 * @param shortName - the module's short name (its package name without the scope).
 * @returns the catalog row, or the uncataloged platform fallback.
 */
export function catalogRow(shortName: string): PluginCatalogRow {
  return PLUGIN_CATALOG[shortName] ?? { group: UNCATALOGED_GROUP, descriptionKey: 'descUncataloged' }
}

/**
 * Whether the plugin page lists one module in its user-managed region.
 * @param shortName - the module's short name (its package name without the scope).
 * @returns true for the curated optional, user-facing capability rows.
 */
export function isManagedPlugin(shortName: string): boolean {
  return PLUGIN_CATALOG[shortName]?.managed === true
}
