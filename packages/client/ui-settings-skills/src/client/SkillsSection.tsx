/**
 * Skills settings section: four tabs over the Host's `skillsAdmin` Remote
 * namespace. Installed lists every discovered skill with its enable switch,
 * an inline editor (create, edit, read-only view), a two-step delete, and the
 * manual rescan. Gallery installs curated skills host-side. Import copies
 * skills from other agents' roots. Create from sessions lists stored sessions
 * folded into collapsible project groups with the create action above them, and
 * distills the selected ones into a new skill through a fresh AI session
 * composed from the Host's skill-authoring work mode. Turning a skill off
 * is a durable write to the `skills` settings namespace, and every mutation
 * answers the whole inventory, so the rows never show a half-applied change.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type {
  SkillAdminEntry, SkillExternalRoot, SkillGalleryEntry,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillEditorState, SkillsSettingsStore, SkillsSettingsState } from './store.ts'
import { skillCopy } from './store.ts'
import { ForgePicker } from './ForgePicker.tsx'
import type { SkillsKey } from './locales.ts'
import styles from './SkillsSection.module.css'

/** Injected dependencies of {@link SkillsSection} (slot `inject`). */
export interface SkillsSectionInjected {
  /** The page store (loaded on mount, replaced by every accepted answer). */
  controller: SkillsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: SkillsSettingsStore['store']
  }
  /** Section copy. */
  t: (key: SkillsKey) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type SkillsSectionProps = Partial<InjectFace<SkillsSectionInjected>>

/** The four tabs of the page, Installed first. */
type SkillsTab = 'installed' | 'gallery' | 'import' | 'forge'

/**
 * Render the Skills section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

/** One fact row of a skill's metadata. */
function Fact({ label, value, code = false }: { label: string; value: string; code?: boolean }): ReactNode {
  return (
    <>
      <dt className={styles['factLabel']}>{label}</dt>
      <dd className={code ? `${styles['factValue']} ${styles['factCode']}` : styles['factValue']}>{value}</dd>
    </>
  )
}

/** The invocation-policy tags of one row, localized and never joined with a separator. */
function InvocationTags({ entry, t }: { entry: SkillAdminEntry; t: (key: SkillsKey) => string }): ReactNode {
  return (
    <span className={styles['tags']} role="img" aria-label={t('invocation')} title={t('invocation')}>
      {entry.modelInvocable ? <span className={styles['tag']}>{t('policyModel')}</span> : null}
      {entry.userInvocable ? <span className={styles['tag']}>{t('policyUser')}</span> : null}
      {entry.modelInvocable || entry.userInvocable ? null : <span className={styles['tag']}>{t('policyNone')}</span>}
    </span>
  )
}

/**
 * Whether a row may offer delete: only the user skills roots are writable, and
 * their discovery source buckets are `user-dsh` and `user-agents`. The loaded
 * editor document's `writable` flag stays the authoritative verdict for edits.
 */
function rowWritable(entry: SkillAdminEntry): boolean {
  return entry.source === 'user-dsh' || entry.source === 'user-agents'
}

function Loaded({ injected }: { injected: InjectFace<SkillsSectionInjected> }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [tab, setTab] = useState<SkillsTab>('installed')

  if (state.status === 'idle') void controller.load()

  const activate = (next: SkillsTab): void => {
    setTab(next)
    if (next === 'gallery' && state.gallery.status === 'idle') void controller.loadGallery()
    if (next === 'import' && state.external.status === 'idle') void controller.loadExternal()
    if (next === 'forge' && state.forge.status === 'idle') void controller.loadForgeSessions()
  }

  if (state.status === 'error') {
    return (
      <div className={styles['section']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p role="alert" className={styles['error']}>{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <button
          type="button"
          className={styles['secondaryButton']}
          onClick={() => { void controller.load() }}
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  const tabs: readonly { id: SkillsTab; label: string }[] = [
    { id: 'installed', label: t('tabInstalled') },
    { id: 'gallery', label: t('tabGallery') },
    { id: 'import', label: t('tabImport') },
    { id: 'forge', label: t('tabForge') },
  ]

  return (
    <div className={styles['section']}>
      <div className={styles['tabs']} role="tablist">
        {tabs.map(candidate => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            className={tab === candidate.id ? `${styles['tab']} ${styles['tabActive']}` : styles['tab']}
            onClick={() => { activate(candidate.id) }}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      {tab === 'installed' ? <InstalledTab injected={injected} state={state} /> : null}
      {tab === 'gallery' ? <GalleryTab injected={injected} state={state} /> : null}
      {tab === 'import' ? <ImportTab injected={injected} state={state} /> : null}
      {tab === 'forge' ? <ForgeTab injected={injected} state={state} /> : null}
    </div>
  )
}

/** Shared tab props: the inject face plus the current snapshot. */
interface TabProps {
  injected: InjectFace<SkillsSectionInjected>
  state: SkillsSettingsState
}

function InstalledTab({ injected, state }: TabProps): ReactNode {
  const { controller, t } = injected
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | undefined>(undefined)
  const [confirming, setConfirming] = useState<string | null>(null)

  const run = (operation: () => Promise<string | undefined | void>): void => {
    setWriteError(undefined)
    setBusy(true)
    void operation()
      .then((failure) => { if (failure !== undefined) setWriteError(failure) })
      .finally(() => { setBusy(false); setConfirming(null) })
  }

  return (
    <>
      <div className={styles['head']}>
        <div className={styles['headText']}>
          <h2 className={styles['title']}>{t('title')}</h2>
          <p className={styles['intro']}>{t('intro')}</p>
        </div>
        <div className={styles['headActions']}>
          <button
            type="button"
            className={styles['primaryButton']}
            disabled={busy || !state.writable}
            onClick={() => { controller.openCreate() }}
          >
            {t('newSkill')}
          </button>
          <button
            type="button"
            className={styles['secondaryButton']}
            title={t('rescanHint')}
            disabled={busy || state.status === 'loading'}
            onClick={() => { run(() => controller.rescan()) }}
          >
            {state.status === 'loading' ? t('rescanning') : t('rescan')}
          </button>
        </div>
      </div>
      {state.writable ? null : <p className={styles['notice']}>{t('readOnly')}</p>}
      {writeError === undefined ? null : <p role="alert" className={styles['error']}>{writeError}</p>}
      {state.editor.open ? <SkillEditor injected={injected} editor={state.editor} busy={busy} /> : null}
      {state.status === 'ready' && state.entries.length === 0
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['rows']}>
            {state.entries.map(entry => (
              <li
                key={entry.name}
                className={entry.disabled ? `${styles['row']} ${styles['rowDisabled']}` : styles['row']}
              >
                <label className={styles['rowHead']}>
                  <input
                    type="checkbox"
                    className={styles['checkbox']}
                    checked={!entry.disabled}
                    disabled={!state.writable || busy}
                    aria-label={skillCopy(entry.disabled ? t('toggleEnable') : t('toggleDisable'), entry.name)}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      run(() => controller.setDisabled(entry.name, !enabled))
                    }}
                  />
                  <span className={styles['rowName']}>{entry.name}</span>
                  <span className={styles['rowState']}>{entry.disabled ? t('disabled') : t('enabled')}</span>
                  <InvocationTags entry={entry} t={t} />
                </label>
                <p className={styles['rowDescription']}>{entry.description}</p>
                <dl className={styles['facts']}>
                  <Fact label={t('source')} value={entry.source} />
                  <Fact label={t('provider')} value={entry.provider} />
                  {entry.directory === undefined
                    ? null
                    : <Fact label={t('directory')} value={entry.directory} code />}
                </dl>
                <div className={styles['rowActions']}>
                  <button
                    type="button"
                    className={styles['linkButton']}
                    aria-label={skillCopy(t('viewEditAria'), entry.name)}
                    disabled={busy}
                    onClick={() => { void controller.openEdit(entry.name) }}
                  >
                    {t('viewEdit')}
                  </button>
                  {rowWritable(entry)
                    ? confirming === entry.name
                      ? (
                        <>
                          <button
                            type="button"
                            className={`${styles['linkButton']} ${styles['linkButtonDanger']}`}
                            disabled={busy}
                            onClick={() => { run(() => controller.remove(entry.name)) }}
                          >
                            {t('deleteConfirm')}
                          </button>
                          <button
                            type="button"
                            className={styles['linkButton']}
                            disabled={busy}
                            onClick={() => { setConfirming(null) }}
                          >
                            {t('deleteCancel')}
                          </button>
                        </>
                      )
                      : (
                        <button
                          type="button"
                          className={`${styles['linkButton']} ${styles['linkButtonDanger']}`}
                          aria-label={skillCopy(t('deleteAria'), entry.name)}
                          disabled={busy || !state.writable}
                          onClick={() => { setConfirming(entry.name) }}
                        >
                          {t('deleteLabel')}
                        </button>
                      )
                    : null}
                </div>
              </li>
            ))}
          </ul>
        )}
    </>
  )
}

/**
 * The inline skill editor card. Fields remount per skill through the `key` the
 * parent derives, so their initial values always match the loaded document.
 */
function SkillEditor(
  props: { injected: InjectFace<SkillsSectionInjected>; editor: SkillEditorState; busy: boolean },
): ReactNode {
  const { injected, editor, busy } = props
  return (
    <SkillEditorFields
      key={editor.create ? 'create' : `${editor.name}:${editor.detail === null ? 'loading' : 'ready'}`}
      injected={injected}
      editor={editor}
      busy={busy}
    />
  )
}

function SkillEditorFields(
  { injected, editor, busy }: { injected: InjectFace<SkillsSectionInjected>; editor: SkillEditorState; busy: boolean },
): ReactNode {
  const { controller, t } = injected
  const [name, setName] = useState(editor.create ? '' : editor.name)
  const [description, setDescription] = useState(editor.detail?.description ?? '')
  const [whenToUse, setWhenToUse] = useState(editor.detail?.whenToUse ?? '')
  const [content, setContent] = useState(editor.detail?.content ?? '')
  const [saving, setSaving] = useState(false)

  // The document's own flag decides view vs edit; create mode is always writable.
  const viewOnly = !editor.create && editor.detail !== null && !editor.detail.writable
  const fieldsDisabled = viewOnly || editor.loading || saving
  const title = editor.create
    ? t('editorCreateTitle')
    : skillCopy(t(viewOnly ? 'editorViewTitle' : 'editorEditTitle'), editor.name)

  const save = (): void => {
    setSaving(true)
    void controller.save({ name: name.trim(), description, whenToUse, content }, editor.create)
      .finally(() => { setSaving(false) })
  }

  return (
    <div className={styles['editor']}>
      <h3 className={styles['editorTitle']}>{title}</h3>
      {viewOnly ? <p className={styles['notice']}>{t('editorReadOnlyNote')}</p> : null}
      {editor.loading ? <p className={styles['intro']}>{t('editorLoading')}</p> : null}
      {editor.error === null ? null : <p role="alert" className={styles['error']}>{editor.error}</p>}
      <label className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fieldName')}</span>
        <input
          type="text"
          className={styles['input']}
          value={name}
          placeholder={t('fieldNamePlaceholder')}
          disabled={!editor.create || fieldsDisabled}
          onChange={(event) => { setName(event.target.value) }}
        />
      </label>
      <label className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fieldDescription')}</span>
        <input
          type="text"
          className={styles['input']}
          value={description}
          disabled={fieldsDisabled}
          onChange={(event) => { setDescription(event.target.value) }}
        />
      </label>
      <label className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fieldWhenToUse')}</span>
        <input
          type="text"
          className={styles['input']}
          value={whenToUse}
          disabled={fieldsDisabled}
          onChange={(event) => { setWhenToUse(event.target.value) }}
        />
      </label>
      <label className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fieldContent')}</span>
        <textarea
          className={styles['textarea']}
          rows={16}
          value={content}
          disabled={fieldsDisabled}
          onChange={(event) => { setContent(event.target.value) }}
        />
      </label>
      <div className={styles['editorActions']}>
        {viewOnly
          ? null
          : (
            <button
              type="button"
              className={styles['primaryButton']}
              disabled={fieldsDisabled || busy || name.trim() === '' || description.trim() === ''}
              onClick={save}
            >
              {t('save')}
            </button>
          )}
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={saving}
          onClick={() => { controller.closeEditor() }}
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}

function GalleryTab({ injected, state }: TabProps): ReactNode {
  const { controller, t } = injected
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)

  const install = (entry: SkillGalleryEntry): void => {
    setFailure(null)
    setBusyId(entry.id)
    void controller.installGallery(entry.id)
      .then((message) => { if (message !== undefined) setFailure({ id: entry.id, message }) })
      .finally(() => { setBusyId(null) })
  }

  return (
    <>
      <p className={styles['intro']}>{t('galleryIntro')}</p>
      {state.gallery.status === 'error'
        ? (
          <>
            <p role="alert" className={styles['error']}>{`${t('galleryFailed')}: ${state.gallery.error ?? ''}`}</p>
            <div>
              <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.loadGallery() }}>
                {t('retry')}
              </button>
            </div>
          </>
        )
        : (
          <ul className={styles['rows']}>
            {state.gallery.entries.map(entry => (
              <li key={entry.id} className={styles['row']}>
                <div className={styles['rowHead']}>
                  <span className={styles['rowName']}>{entry.name}</span>
                  {entry.installed ? <span className={styles['tag']}>{t('galleryInstalled')}</span> : null}
                  <span className={styles['tags']}>
                    <button
                      type="button"
                      className={styles['secondaryButton']}
                      disabled={entry.installed || busyId !== null}
                      onClick={() => { install(entry) }}
                    >
                      {busyId === entry.id ? t('galleryInstalling') : t('galleryInstall')}
                    </button>
                  </span>
                </div>
                <p className={styles['rowDescription']}>{entry.description}</p>
                <dl className={styles['facts']}>
                  <Fact label={t('galleryOrigin')} value={entry.origin} />
                  <Fact label={t('galleryLicense')} value={entry.license} />
                </dl>
                <a className={styles['link']} href={entry.repoUrl} target="_blank" rel="noreferrer">
                  {t('galleryRepo')}
                </a>
                {failure?.id === entry.id
                  ? <p role="alert" className={styles['error']}>{failure.message}</p>
                  : null}
              </li>
            ))}
          </ul>
        )}
    </>
  )
}

function ImportTab({ injected, state }: TabProps): ReactNode {
  const { controller, t } = injected
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null)
  const [customPath, setCustomPath] = useState('')

  const installedNames = new Set(state.entries.map(entry => entry.name))

  const importPath = (path: string): void => {
    setFailure(null)
    setBusyPath(path)
    void controller.importExternal(path)
      .then((message) => { if (message !== undefined) setFailure({ path, message }) })
      .finally(() => { setBusyPath(null) })
  }

  const renderRoot = (root: SkillExternalRoot): ReactNode => (
    <li key={root.path} className={styles['row']}>
      <div className={styles['rowHead']}>
        <span className={styles['rowName']}>{root.label}</span>
        <span className={`${styles['factValue']} ${styles['factCode']}`}>{root.path}</span>
      </div>
      <ul className={styles['rows']}>
        {root.skills.map(skill => (
          <li key={skill.path} className={styles['row']}>
            <div className={styles['rowHead']}>
              <span className={styles['rowName']}>{skill.name}</span>
              <span className={styles['tags']}>
                <button
                  type="button"
                  className={styles['secondaryButton']}
                  disabled={busyPath !== null || installedNames.has(skill.name)}
                  onClick={() => { importPath(skill.path) }}
                >
                  {t('importLabel')}
                </button>
              </span>
            </div>
            {skill.description === ''
              ? <span className={`${styles['factValue']} ${styles['factCode']}`}>{skill.path}</span>
              : <p className={styles['rowDescription']}>{skill.description}</p>}
            {failure?.path === skill.path
              ? <p role="alert" className={styles['error']}>{failure.message}</p>
              : null}
          </li>
        ))}
      </ul>
    </li>
  )

  return (
    <>
      <p className={styles['intro']}>{t('importIntro')}</p>
      {state.external.status === 'error'
        ? (
          <>
            <p role="alert" className={styles['error']}>{`${t('importFailed')}: ${state.external.error ?? ''}`}</p>
            <div>
              <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.loadExternal() }}>
                {t('retry')}
              </button>
            </div>
          </>
        )
        : state.external.status === 'ready' && state.external.roots.length === 0
          ? <p className={styles['empty']}>{t('importEmpty')}</p>
          : <ul className={styles['rows']}>{state.external.roots.map(renderRoot)}</ul>}
      <div className={styles['editor']}>
        <h3 className={styles['editorTitle']}>{t('importCustomLabel')}</h3>
        <p className={styles['intro']}>{t('importCustomHint')}</p>
        <div className={styles['importRow']}>
          <input
            type="text"
            className={styles['input']}
            aria-label={t('importCustomLabel')}
            placeholder={t('importCustomPlaceholder')}
            value={customPath}
            disabled={busyPath !== null}
            onChange={(event) => { setCustomPath(event.target.value) }}
          />
          <button
            type="button"
            className={styles['primaryButton']}
            disabled={busyPath !== null || customPath.trim() === ''}
            onClick={() => { importPath(customPath.trim()) }}
          >
            {t('importLabel')}
          </button>
        </div>
        {failure !== null && failure.path === customPath.trim()
          ? <p role="alert" className={styles['error']}>{failure.message}</p>
          : null}
      </div>
    </>
  )
}

/** The create-from-sessions tab: the shared picker, inline in the page. */
function ForgeTab({ injected, state }: TabProps): ReactNode {
  const { controller, t } = injected
  return <ForgePicker controller={controller} state={state} t={t} />
}
