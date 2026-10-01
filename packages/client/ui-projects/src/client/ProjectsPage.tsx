/**
 * The project management page: one `settings.section` row over the `workspace`
 * Remote namespace. It lists every project (the Host's Workspace entity) with
 * its working directory, its project directory, the managed subdirectory state
 * `ensureProject` reports, and — on demand — the preset roster the project's
 * working directory resolves, each row marked with the layer it came from.
 *
 * The page owns no business state: every read and mutation goes through the
 * injected Remote adapters, and the project list itself arrives through the
 * global `useWorkspaces` selector hook (the bare Workspace Controller snapshot
 * the ui-workspace plugin publishes at the root).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the global `useWorkspaces` standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  WorkspaceId, WorkspaceProjectDirValue, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
import type { ProjectsLocaleKey } from './locales.ts'
import css from './ProjectsPage.module.css'

/** Project-directory read state for one project card. */
type DirState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: WorkspaceProjectDirValue }
  | { readonly status: 'failed' }

/** Preset-roster read state for one expanded project card. */
type PresetState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly roster: AgentPresetRoster }
  | { readonly status: 'failed'; readonly message: string }

/** The one open directory/name dialog, or null. */
interface DialogState {
  readonly kind: 'rename' | 'repoint' | 'create'
  /** Target project; absent for a create. */
  readonly workspaceId?: WorkspaceId
  readonly value: string
  readonly busy: boolean
  readonly error: string | null
}

/** Managed subdirectories `ensureProject` reports, in display order. */
const SUBDIRECTORIES: readonly (readonly ['memory' | 'presets' | 'automations', ProjectsLocaleKey])[] = [
  ['memory', 'subdir.memory'],
  ['presets', 'subdir.presets'],
  ['automations', 'subdir.automations'],
]

/** Remote adapters the page drives; supplied by the register inject factory. */
export interface ProjectsPageInjected {
  /** Rename one project (Host name conflict rejects). */
  readonly renameProject: (workspaceId: WorkspaceId, title: string) => Promise<void>
  /** Point one project at an absolute custom project directory. */
  readonly setProjectDir: (workspaceId: WorkspaceId, path: string) => Promise<void>
  /** Restore one project's derived default project directory. */
  readonly resetProjectDir: (workspaceId: WorkspaceId) => Promise<void>
  /** Materialize one project's directory tree and report its subdirectories. */
  readonly ensureProject: (workspaceId: WorkspaceId) => Promise<WorkspaceProjectDirValue>
  /** Adopt an existing directory as a new project. */
  readonly createProject: (path: string) => Promise<WorkspaceView>
  /** Open the host directory picker; null when the operator cancels. */
  readonly pickDirectory: () => Promise<string | null>
  /** Read the preset roster one working directory resolves, rows marked by layer. */
  readonly loadPresets: (cwd: string) => Promise<AgentPresetRoster>
}

/** Full page props: the settings owner share, the locale seat, and the injected adapters. */
export type ProjectsPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.projects'>
  & ProjectsPageInjected

/** Render the project management page. */
export function ProjectsPage(props: ProjectsPageProps): ReactNode {
  const {
    renameProject, setProjectDir, resetProjectDir, ensureProject,
    createProject, pickDirectory, loadPresets, useWorkspaces, t,
  } = props
  const snapshot = useWorkspaces(state => state)
  const items = snapshot.items
  const [dirs, setDirs] = useState<Readonly<Record<string, DirState>>>({})
  const [presets, setPresets] = useState<Readonly<Record<string, PresetState>>>({})
  const [expanded, setExpanded] = useState<WorkspaceId | undefined>(undefined)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [browsing, setBrowsing] = useState(false)
  /** Failure of a card action that owns no dialog of its own. */
  const [pageError, setPageError] = useState<string | null>(null)
  /** Re-issues every project-directory read; bumped after a repoint or reset. */
  const [generation, setGeneration] = useState(0)
  // One ensureProject per project per generation: the effect re-runs on every
  // list change, and a Host that republishes a row must not re-issue the read.
  const requested = useRef(new Set<string>())

  useEffect(() => {
    requested.current.clear()
    setDirs({})
  }, [generation])

  useEffect(() => {
    for (const item of items) {
      const id = String(item.workspaceId)
      if (requested.current.has(id)) continue
      requested.current.add(id)
      setDirs(previous => ({ ...previous, [id]: { status: 'loading' } }))
      void ensureProject(item.workspaceId).then(
        value => { setDirs(previous => ({ ...previous, [id]: { status: 'ready', value } })) },
        () => { setDirs(previous => ({ ...previous, [id]: { status: 'failed' } })) },
      )
    }
  }, [items, ensureProject, generation])

  const openDialog = (next: DialogState): void => {
    setDialog(next)
    setBrowsing(false)
  }

  const togglePresets = (item: WorkspaceView): void => {
    if (expanded === item.workspaceId) {
      setExpanded(undefined)
      return
    }
    setExpanded(item.workspaceId)
    if (presets[String(item.workspaceId)]?.status === 'ready') return
    const id = String(item.workspaceId)
    setPresets(previous => ({ ...previous, [id]: { status: 'loading' } }))
    void loadPresets(item.path).then(
      roster => { setPresets(previous => ({ ...previous, [id]: { status: 'ready', roster } })) },
      (reason: unknown) => {
        setPresets(previous => ({
          ...previous,
          [id]: { status: 'failed', message: reason instanceof Error ? reason.message : String(reason) },
        }))
      },
    )
  }

  const browse = (): void => {
    setBrowsing(true)
    void pickDirectory().then(
      (path) => {
        setBrowsing(false)
        if (path !== null) setDialog(current => current === null ? current : { ...current, value: path, error: null })
      },
      (reason: unknown) => {
        setBrowsing(false)
        const message = reason instanceof Error ? reason.message : String(reason)
        setDialog(current => current === null ? current : { ...current, error: t('browseFailed', { message }) })
      },
    )
  }

  const confirmDialog = (): void => {
    if (dialog === null || dialog.busy) return
    const value = dialog.value.trim()
    if (dialog.kind !== 'rename' && value === '') {
      setDialog({ ...dialog, error: t('pathRequired') })
      return
    }
    if (dialog.kind !== 'create' && dialog.workspaceId === undefined) return
    setDialog({ ...dialog, busy: true, error: null })
    const action = dialog.kind === 'create'
      ? createProject(value).then(() => undefined)
      : dialog.kind === 'rename'
        ? renameProject(dialog.workspaceId as WorkspaceId, value)
        : setProjectDir(dialog.workspaceId as WorkspaceId, value)
    void action.then(
      () => {
        setDialog(null)
        // A repoint or reset moves the managed directories; the tree is re-read.
        if (dialog.kind !== 'rename') setGeneration(current => current + 1)
      },
      (reason: unknown) => {
        setDialog({
          ...dialog,
          busy: false,
          error: reason instanceof Error ? reason.message : String(reason),
        })
      },
    )
  }

  const resetDir = (item: WorkspaceView): void => {
    setPageError(null)
    void resetProjectDir(item.workspaceId).then(
      () => { setGeneration(current => current + 1) },
      (reason: unknown) => { setPageError(reason instanceof Error ? reason.message : String(reason)) },
    )
  }

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.blurb}>{t('blurb')}</p>
      <div className={css.toolbar}>
        <Button
          variant="primary"
          onClick={() => { openDialog({ kind: 'create', value: '', busy: false, error: null }) }}
        >
          {t('newProject')}
        </Button>
        {snapshot.phase === 'pending' ? <span className={css.status}>{t('loading')}</span> : null}
      </div>

      {pageError === null
        ? null
        : <p className={css.failure} role="alert">{`${t('errorBare')} ${pageError}`}</p>}

      {snapshot.state === 'error'
        ? (
          <p className={css.failure} role="alert">
            <span>{t('error')}</span>
            <button type="button" onClick={() => { setGeneration(current => current + 1) }}>{t('retry')}</button>
          </p>
        )
        : null}

      {snapshot.phase === 'ready' && items.length === 0
        ? <p className={css.status}>{t('empty')}</p>
        : null}

      <ul className={css.cards}>
        {items.map((item) => {
          const id = String(item.workspaceId)
          const dir = dirs[id]
          const preset = presets[id]
          const isOpen = expanded === item.workspaceId
          return (
            <li key={id} className={css.card} data-testid="project-card">
              <div className={css.cardHead}>
                <span className={css.cardName}>{item.title}</span>
                {item.isDefault ? <span className={css.chip}>{t('defaultBadge')}</span> : null}
                {item.projectDirCustom ? <span className={css.chip} data-tone="accent">{t('customBadge')}</span> : null}
                <span className={css.sessions}>{t('sessionsCount', { count: String(item.sessionIds.length) })}</span>
              </div>

              <dl className={css.facts}>
                <dt>{t('directoryLabel')}</dt>
                <dd title={item.path}>{item.path}</dd>
                <dt>{t('projectDirLabel')}</dt>
                <dd title={item.projectDir}>{item.projectDir}</dd>
              </dl>

              <div className={css.subdirs}>
                <span className={css.subdirLabel}>{t('subdir.label')}</span>
                {SUBDIRECTORIES.map(([key, label]) => {
                  const present = dir?.status === 'ready' ? dir.value.subdirectories[key] : undefined
                  return (
                    <span
                      key={key}
                      className={css.subdir}
                      data-state={dir === undefined || dir.status === 'loading'
                        ? 'loading'
                        : dir.status === 'failed'
                          ? 'failed'
                          : present === true ? 'present' : 'missing'}
                    >
                      {`${t(label)} · ${dir === undefined || dir.status === 'loading'
                        ? t('subdir.loading')
                        : dir.status === 'failed'
                          ? t('subdir.failed')
                          : present === true ? t('subdir.present') : t('subdir.missing')}`}
                    </span>
                  )
                })}
              </div>

              <div className={css.actions}>
                <Button onClick={() => { openDialog({
                  kind: 'rename', workspaceId: item.workspaceId, value: item.title, busy: false, error: null,
                }) }}>{t('rename')}</Button>
                <Button onClick={() => { openDialog({
                  kind: 'repoint', workspaceId: item.workspaceId, value: item.projectDir, busy: false, error: null,
                }) }}>{t('repoint')}</Button>
                <Button onClick={() => { resetDir(item) }}>{t('reset')}</Button>
                <Button onClick={() => { togglePresets(item) }}>
                  {t('presetsShow', { count: String(preset?.status === 'ready' ? preset.roster.presets.length : 0) })}
                </Button>
              </div>

              {isOpen
                ? (
                  <div className={css.presets}>
                    {preset === undefined || preset.status === 'loading'
                      ? <p className={css.status}>{t('presetsLoading')}</p>
                      : preset.status === 'failed'
                        ? <p className={css.failure} role="alert">{t('presetsFailed', { message: preset.message })}</p>
                        : preset.roster.presets.length === 0
                          ? <p className={css.status}>{t('presetsEmpty')}</p>
                          : (
                            <ul className={css.presetList}>
                              {preset.roster.presets.map(row => (
                                <li key={row.id} className={css.presetRow} data-testid="project-preset-row">
                                  <span className={css.presetName}>{row.name ?? row.id}</span>
                                  <span className={css.presetId}>{row.id}</span>
                                  {row.scope === 'project'
                                    ? <span className={css.chip} data-tone="accent">{t('presetProjectBadge')}</span>
                                    : null}
                                  <span className={css.chip}>
                                    {row.trust === 'system' ? t('presetTrustSystem') : t('presetTrustUser')}
                                  </span>
                                  {row.isDefault === true ? <span className={css.chip}>{t('presetDefaultBadge')}</span> : null}
                                  {row.broken === undefined
                                    ? null
                                    : <span className={css.chip} data-tone="danger" title={row.broken}>{t('presetBrokenBadge')}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                  </div>
                )
                : null}
            </li>
          )
        })}
      </ul>

      <Modal
        open={dialog !== null}
        onClose={() => { if (dialog?.busy !== true) setDialog(null) }}
        closeLabel={t('cancel')}
        title={dialog === null ? '' : dialog.kind === 'rename'
          ? t('renameTitle')
          : dialog.kind === 'repoint' ? t('repointTitle') : t('createTitle')}
        footer={(
          <>
            <Button variant="outline" disabled={dialog?.busy === true} onClick={() => { setDialog(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={dialog?.busy === true || browsing} onClick={confirmDialog}>
              {dialog?.busy === true ? t('busy') : t('confirm')}
            </Button>
          </>
        )}
      >
        {dialog === null
          ? null
          : (
            <div className={css.dialogBody}>
              <label className={css.dialogField}>
                <span>{dialog.kind === 'rename' ? t('renameNameLabel') : t('pathLabel')}</span>
                <Input
                  value={dialog.value}
                  autoFocus
                  placeholder={dialog.kind === 'rename' ? undefined : t('directoryPlaceholder')}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setDialog(current => current === null ? current : { ...current, value, error: null })
                  }}
                />
              </label>
              {dialog.kind === 'rename'
                ? null
                : (
                  <div className={css.dialogRow}>
                    <Button disabled={browsing || dialog.busy} onClick={browse}>
                      {browsing ? t('browseBusy') : t('browse')}
                    </Button>
                    <span className={css.hint}>{t('directoryHint')}</span>
                  </div>
                )}
              {dialog.error === null ? null : <p className={css.failure} role="alert">{dialog.error}</p>}
            </div>
          )}
      </Modal>
    </div>
  )
}
