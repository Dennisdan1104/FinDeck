/**
 * MCP servers settings section: one row per configured server with its
 * transport, connection state, and the tools it currently exposes, plus the
 * editor that creates and updates a definition. The Host owns the durable list
 * and mounts one MCP client per enabled server, so every control here writes
 * through the `mcpAdmin` Remote and answers with the whole snapshot the change
 * produced — the row never shows a half-applied edit.
 *
 * Environment variables and request headers are write-only: the Host never
 * sends their values, so the editor starts them empty and an untouched field
 * keeps whatever is stored. That is why the two fields are tracked as "touched"
 * rather than as text — an empty textarea cannot distinguish "keep" from
 * "clear" on its own.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  McpServerInput, McpServerStatus, McpServerTemplate, McpServerView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpSettingsState, McpSettingsStore } from './store.ts'
import { fillTemplate } from './store.ts'
import type { McpKey } from './locales.ts'
import styles from './McpSection.module.css'

/** Injected dependencies of {@link McpSection} (slot `inject`). */
export interface McpSectionInjected {
  /** The page store (loaded on mount, replaced by every accepted answer). */
  controller: McpSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: McpSettingsStore['store']
  }
  /** Section copy. */
  t: (key: McpKey) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type McpSectionProps = Partial<InjectFace<McpSectionInjected>>

/** Server-name grammar the Host accepts for a tool namespace. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** The status word one badge renders. */
const STATUS_LABELS: Readonly<Record<McpServerStatus, McpKey>> = {
  disabled: 'statusDisabled',
  connecting: 'statusConnecting',
  connected: 'statusConnected',
  disconnected: 'statusDisconnected',
  error: 'statusError',
}

/** The tone class one status dot takes. */
const STATUS_TONES: Readonly<Record<McpServerStatus, string>> = {
  disabled: 'toneDisabled',
  connecting: 'tonePending',
  connected: 'toneOnline',
  disconnected: 'toneOffline',
  error: 'toneError',
}

/**
 * Render the MCP servers section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function McpSection(props: McpSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

/** The write-in-flight state the editor and its row share. */
type Operation = () => Promise<string | undefined | void>

/** One server's editable definition as the form holds it. */
interface Draft {
  /** Stored id being updated; empty for a server that does not exist yet. */
  readonly id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  /** One argument per line, split on submit. */
  argsText: string
  cwd: string
  url: string
  /** Write-only field text; `envTouched` alone decides whether it is submitted. */
  envText: string
  envTouched: boolean
  headersText: string
  headersTouched: boolean
}

/**
 * The draft one server opens with. Environment variables and headers start
 * empty and untouched: the snapshot carries no value for either.
 * @param server - the server being edited, absent when creating one.
 * @returns the initial form state.
 */
function draftOf(server: McpServerView | undefined): Draft {
  if (server === undefined) {
    return {
      id: '', serverName: '', transport: 'stdio', command: '', argsText: '', cwd: '', url: '',
      envText: '', envTouched: false, headersText: '', headersTouched: false,
    }
  }
  return {
    id: server.id,
    serverName: server.serverName,
    transport: server.transport,
    command: server.command,
    argsText: server.args.join('\n'),
    cwd: server.cwd,
    url: server.url,
    envText: '',
    envTouched: false,
    headersText: '',
    headersTouched: false,
  }
}

/**
 * The draft one template prefill opens with. Environment variables stay empty
 * and untouched even when the template names them — the values are the user's
 * to supply, and the badge on the card already lists the expected names.
 * @param template - the curated template being adopted.
 * @returns the prefilled form state.
 */
function draftOfTemplate(template: McpServerTemplate): Draft {
  return {
    id: '',
    serverName: template.serverName,
    transport: template.transport,
    command: template.command,
    argsText: template.args.join('\n'),
    cwd: '',
    url: '',
    envText: '',
    envTouched: false,
    headersText: '',
    headersTouched: false,
  }
}

/** Split an arguments textarea into the verbatim argument list. */
function argumentLines(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

/**
 * Parse a `NAME=VALUE` textarea into a map.
 * @param text - one entry per line; blank lines are ignored.
 * @returns the map, or undefined when a non-empty line is not a valid entry.
 */
function parseEntries(text: string): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) return undefined
    const name = trimmed.slice(0, separator).trim()
    if (name.length === 0 || /\s/.test(name)) return undefined
    entries[name] = trimmed.slice(separator + 1)
  }
  return entries
}

/** Whether a value is an absolute HTTP(S) URL. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_invalidUrl) {
    return false
  }
}

/**
 * The form's own gate: the first field that would be refused, named in the
 * page's copy rather than by a schema path.
 * @param draft - the form's current state.
 * @param t - section copy.
 * @returns the failure message, or undefined when the draft may be submitted.
 */
function draftFailure(draft: Draft, t: (key: McpKey) => string): string | undefined {
  if (!SERVER_NAME_PATTERN.test(draft.serverName.trim())) return t('invalidServerName')
  if (draft.transport === 'stdio' && draft.command.trim().length === 0) return t('invalidCommand')
  if (draft.transport === 'streamable-http' && !isHttpUrl(draft.url.trim())) return t('invalidUrl')
  if (draft.envTouched && parseEntries(draft.envText) === undefined) {
    return `${t('fieldEnv')}: ${t('invalidEntries')}`
  }
  if (draft.headersTouched && parseEntries(draft.headersText) === undefined) {
    return `${t('fieldHeaders')}: ${t('invalidEntries')}`
  }
  return undefined
}

/** The Remote write one submitted draft carries. */
function inputOf(draft: Draft): McpServerInput {
  const env = draft.envTouched ? parseEntries(draft.envText) : undefined
  const headers = draft.headersTouched ? parseEntries(draft.headersText) : undefined
  return {
    id: draft.id,
    serverName: draft.serverName.trim(),
    transport: draft.transport,
    command: draft.command.trim(),
    args: argumentLines(draft.argsText),
    cwd: draft.cwd.trim(),
    url: draft.url.trim(),
    ...env === undefined ? {} : { env },
    ...headers === undefined ? {} : { headers },
  }
}

/** One status dot plus its word. */
function StatusBadge({ status, t }: { status: McpServerStatus; t: (key: McpKey) => string }): ReactNode {
  return (
    <span className={styles['status']}>
      <span className={`${styles['statusDot']} ${styles[STATUS_TONES[status]]}`} aria-hidden="true" />
      <span className={styles['statusLabel']}>{t(STATUS_LABELS[status])}</span>
    </span>
  )
}

/** One label/value fact of a server's metadata block. */
function Fact({ label, value, code = false }: { label: string; value: string; code?: boolean }): ReactNode {
  return (
    <>
      <dt className={styles['factLabel']}>{label}</dt>
      <dd className={code ? `${styles['factValue']} ${styles['factCode']}` : styles['factValue']}>{value}</dd>
    </>
  )
}

/** The tools one server currently exposes, folded under its row. */
function ToolList({ server, t }: { server: McpServerView; t: (key: McpKey) => string }): ReactNode {
  if (server.tools.length === 0) return <p className={styles['hint']}>{t('toolsNone')}</p>
  return (
    <details className={styles['tools']}>
      <summary className={styles['toolsSummary']}>
        {fillTemplate(t('toolsCount'), { count: String(server.tools.length) })}
      </summary>
      <ul className={styles['toolList']}>
        {server.tools.map(tool => (
          <li key={tool.name} className={styles['tool']}>
            <span className={styles['toolName']}>{tool.name}</span>
            {tool.description.length === 0 ? null : <span className={styles['toolDescription']}>{tool.description}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The definition editor: one form for creating and updating a server. */
function ServerEditor({
  server, template, busy, t, onSubmit, onCancel,
}: {
  server: McpServerView | undefined
  /** Curated template whose values prefill a new draft; undefined for a blank form. */
  template: McpServerTemplate | undefined
  busy: boolean
  t: (key: McpKey) => string
  onSubmit: (input: McpServerInput) => void
  onCancel: () => void
}): ReactNode {
  const [draft, setDraft] = useState<Draft>(() => template === undefined ? draftOf(server) : draftOfTemplate(template))
  const failure = draftFailure(draft, t)
  const edit = (patch: Partial<Draft>): void => { setDraft(current => ({ ...current, ...patch })) }
  const stdio = draft.transport === 'stdio'

  return (
    <div className={styles['editor']}>
      <div className={styles['editorHeader']}>
        <span className={styles['editorTitle']}>{t(server === undefined ? 'createTitle' : 'editTitle')}</span>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fieldServerName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={draft.serverName}
          placeholder="filesystem"
          aria-label={t('fieldServerName')}
          disabled={busy}
          onChange={(event) => { edit({ serverName: event.target.value }) }}
        />
        <span className={styles['hint']}>{t('fieldServerNameHint')}</span>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('fieldTransport')}</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={draft.transport}
          aria-label={t('fieldTransport')}
          disabled={busy}
          onChange={(event) => {
            edit({ transport: event.target.value === 'streamable-http' ? 'streamable-http' : 'stdio' })
          }}
        >
          <option value="stdio">{t('transportStdio')}</option>
          <option value="streamable-http">{t('transportHttp')}</option>
        </select>
      </div>
      {stdio
        ? (
          <>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('fieldCommand')}</span>
              <input
                className={styles['input']}
                type="text"
                value={draft.command}
                aria-label={t('fieldCommand')}
                disabled={busy}
                onChange={(event) => { edit({ command: event.target.value }) }}
              />
              <span className={styles['hint']}>{t('fieldCommandHint')}</span>
            </div>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('fieldArgs')}</span>
              <textarea
                className={styles['textarea']}
                rows={3}
                value={draft.argsText}
                aria-label={t('fieldArgs')}
                disabled={busy}
                onChange={(event) => { edit({ argsText: event.target.value }) }}
              />
              <span className={styles['hint']}>{t('fieldArgsHint')}</span>
            </div>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('fieldCwd')}</span>
              <input
                className={styles['input']}
                type="text"
                value={draft.cwd}
                aria-label={t('fieldCwd')}
                disabled={busy}
                onChange={(event) => { edit({ cwd: event.target.value }) }}
              />
              <span className={styles['hint']}>{t('fieldCwdHint')}</span>
            </div>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('fieldEnv')}</span>
              <textarea
                className={styles['textarea']}
                rows={4}
                value={draft.envText}
                placeholder={server?.envSet === true ? t('fieldKeepStored') : 'NAME=VALUE'}
                aria-label={t('fieldEnv')}
                disabled={busy}
                onChange={(event) => { edit({ envText: event.target.value, envTouched: true }) }}
              />
              <span className={styles['hint']}>{t('fieldEnvHint')}</span>
            </div>
          </>
        )
        : (
          <>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('fieldUrl')}</span>
              <input
                className={styles['input']}
                type="text"
                value={draft.url}
                placeholder="https://example.com/mcp"
                aria-label={t('fieldUrl')}
                disabled={busy}
                onChange={(event) => { edit({ url: event.target.value }) }}
              />
              <span className={styles['hint']}>{t('fieldUrlHint')}</span>
            </div>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('fieldHeaders')}</span>
              <textarea
                className={styles['textarea']}
                rows={4}
                value={draft.headersText}
                placeholder={server?.headersSet === true ? t('fieldKeepStored') : 'NAME=VALUE'}
                aria-label={t('fieldHeaders')}
                disabled={busy}
                onChange={(event) => { edit({ headersText: event.target.value, headersTouched: true }) }}
              />
              <span className={styles['hint']}>{t('fieldHeadersHint')}</span>
            </div>
          </>
        )}
      {failure === undefined ? null : <p role="alert" className={styles['error']}>{failure}</p>}
      <div className={styles['formActions']}>
        <button type="button" className={styles['secondaryButton']} disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={busy || failure !== undefined}
          onClick={() => { onSubmit(inputOf(draft)) }}
        >
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}

/** One configured server: its state, metadata, tools, and actions. */
function ServerRow({
  server, writable, busy, confirming, t, onToggle, onReconnect, onEdit, onRemove, onCancelRemove,
}: {
  server: McpServerView
  writable: boolean
  busy: boolean
  confirming: boolean
  t: (key: McpKey) => string
  onToggle: (disabled: boolean) => void
  onReconnect: () => void
  onEdit: () => void
  onRemove: () => void
  onCancelRemove: () => void
}): ReactNode {
  const enabled = !server.disabled
  const target = server.transport === 'stdio' ? server.command : server.url
  return (
    <li className={server.disabled ? `${styles['row']} ${styles['rowDisabled']}` : styles['row']}>
      <div className={styles['rowHead']}>
        <label className={styles['rowToggle']}>
          <input
            type="checkbox"
            className={styles['checkbox']}
            checked={enabled}
            disabled={!writable || busy}
            aria-label={fillTemplate(t(enabled ? 'toggleDisable' : 'toggleEnable'), { server: server.serverName })}
            onChange={(event) => { onToggle(!event.target.checked) }}
          />
          <span className={styles['rowName']}>{server.serverName}</span>
        </label>
        <StatusBadge status={server.status} t={t} />
        <span className={styles['tag']}>
          {server.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}
        </span>
        <span className={styles['rowActions']}>
          <button
            type="button"
            className={styles['linkButton']}
            title={t('reconnectHint')}
            disabled={!writable || busy || server.disabled}
            onClick={onReconnect}
          >
            {t('reconnect')}
          </button>
          <button type="button" className={styles['linkButton']} disabled={!writable || busy} onClick={onEdit}>
            {t('edit')}
          </button>
          <button
            type="button"
            className={`${styles['linkButton']} ${styles['linkButtonDanger']}`}
            disabled={!writable || busy}
            onClick={onRemove}
          >
            {t('remove')}
          </button>
        </span>
      </div>
      {confirming
        ? (
          <div className={styles['confirm']}>
            <p role="alert" className={styles['confirmText']}>
              {fillTemplate(t('removeConfirm'), { server: server.serverName })}
            </p>
            <span className={styles['rowActions']}>
              <button type="button" className={styles['secondaryButton']} disabled={busy} onClick={onCancelRemove}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className={`${styles['secondaryButton']} ${styles['dangerButton']}`}
                disabled={busy}
                onClick={onRemove}
              >
                {t('removeConfirmAction')}
              </button>
            </span>
          </div>
        )
        : null}
      <dl className={styles['facts']}>
        <Fact label={server.transport === 'stdio' ? t('factCommand') : t('factUrl')} value={target} code />
        <Fact label={t('factEnv')} value={server.envSet ? t('factSet') : t('factUnset')} />
        <Fact label={t('factHeaders')} value={server.headersSet ? t('factSet') : t('factUnset')} />
      </dl>
      {server.error === undefined ? null : <p role="alert" className={styles['error']}>{server.error}</p>}
      <ToolList server={server} t={t} />
    </li>
  )
}

/** An argument element the template marks as a value the user must supply. */
const PLACEHOLDER_PATTERN = /^<[^<>]+>$/

/**
 * One curated template: its description, homepage link, the requirements the
 * user still has to satisfy, and the button that prefills the editor.
 */
function TemplateCard({
  template, writable, busy, taken, t, onAdd,
}: {
  template: McpServerTemplate
  writable: boolean
  busy: boolean
  /** Whether a configured server already uses the template's serverName. */
  taken: boolean
  t: (key: McpKey) => string
  onAdd: () => void
}): ReactNode {
  const needsValues = template.args.some(argument => PLACEHOLDER_PATTERN.test(argument))
  return (
    <li className={styles['templateCard']}>
      <div className={styles['templateHead']}>
        <span className={styles['templateLabel']}>{template.label}</span>
        <span className={styles['tag']}>
          {template.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}
        </span>
        <a
          className={styles['templateHomepage']}
          href={template.homepage}
          target="_blank"
          rel="noreferrer"
          aria-label={fillTemplate(t('templateHomepage'), { label: template.label })}
        >
          {template.serverName}
        </a>
      </div>
      <p className={styles['templateDescription']}>{template.description}</p>
      <div className={styles['templateBadges']}>
        {template.needsEnv.length === 0 ? null : (
          <span className={styles['badge']}>
            {fillTemplate(t('templateNeedsEnv'), { vars: template.needsEnv.join(', ') })}
          </span>
        )}
        {needsValues ? <span className={styles['badge']}>{t('templateNeedsValues')}</span> : null}
      </div>
      <div className={styles['templateActions']}>
        <button
          type="button"
          className={styles['secondaryButton']}
          title={taken ? fillTemplate(t('templateConflict'), { server: template.serverName }) : t('templateAddHint')}
          disabled={!writable || busy || taken}
          onClick={onAdd}
        >
          {t('templateAdd')}
        </button>
      </div>
    </li>
  )
}

/**
 * The templates block: the curated catalog on its own load track, with an
 * inline failure and retry that never disturbs the server list above it.
 */
function TemplatesBlock({
  templates, writable, busy, servers, t, onAdd, onRetry,
}: {
  templates: McpSettingsState['templates']
  writable: boolean
  busy: boolean
  servers: readonly McpServerView[]
  t: (key: McpKey) => string
  onAdd: (template: McpServerTemplate) => void
  onRetry: () => void
}): ReactNode {
  if (templates.status === 'error') {
    return (
      <div className={styles['templates']}>
        <h3 className={styles['templatesTitle']}>{t('templatesTitle')}</h3>
        <p role="alert" className={styles['error']}>{`${t('templatesLoadFailed')}: ${templates.error ?? ''}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={onRetry}>
          {t('retry')}
        </button>
      </div>
    )
  }
  if (templates.status !== 'ready' || templates.items.length === 0) return null
  return (
    <div className={styles['templates']}>
      <div className={styles['headText']}>
        <h3 className={styles['templatesTitle']}>{t('templatesTitle')}</h3>
        <p className={styles['hint']}>{t('templatesIntro')}</p>
      </div>
      <ul className={styles['templateCards']}>
        {templates.items.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            writable={writable}
            busy={busy}
            taken={servers.some(server => server.serverName === template.serverName)}
            t={t}
            onAdd={() => { onAdd(template) }}
          />
        ))}
      </ul>
    </div>
  )
}

/** The section body, present only once every injected dependency arrived. */
function Loaded({ injected }: { injected: InjectFace<McpSectionInjected> }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  // Every new-server request carries a fresh token: it keys the editor, so an
  // Add click always remounts the form with that request's own draft instead of
  // leaving the one already open untouched.
  const newRequests = useRef(0)
  const newEditor = useRef<HTMLLIElement | null>(null)
  const [editing, setEditing] = useState<
    { mode: 'new'; request: number; template?: McpServerTemplate } | { mode: 'edit'; id: string } | undefined
  >(undefined)
  const [confirming, setConfirming] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | undefined>(undefined)

  // Status is read, not pushed: opening the page is what makes the rows show
  // the state the Host has now.
  useEffect(() => {
    void controller.load()
    void controller.loadTemplates()
  }, [controller])

  // The form mounts at the top of the list, above the server rows: a request
  // issued while the page is scrolled past it (the template cards) still has to
  // become visible. A request whose form is already on screen stays put.
  useEffect(() => {
    newEditor.current?.scrollIntoView({ block: 'nearest' })
  }, [editing])

  const run = (operation: Operation): void => {
    setWriteError(undefined)
    setBusy(true)
    void operation()
      .then((failure) => { if (failure !== undefined) setWriteError(failure) })
      .finally(() => { setBusy(false) })
  }

  /** Open a new-server form: blank, or prefilled from a template. */
  const beginNew = (template?: McpServerTemplate): void => {
    newRequests.current += 1
    setConfirming(undefined)
    setEditing({
      mode: 'new',
      request: newRequests.current,
      ...(template === undefined ? {} : { template }),
    })
  }

  if (state.status === 'error') {
    return (
      <div className={styles['section']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p role="alert" className={styles['error']}>{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { run(() => controller.load()) }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className={styles['section']}>
      <div className={styles['head']}>
        <div className={styles['headText']}>
          <h2 className={styles['title']}>{t('title')}</h2>
          <p className={styles['intro']}>{t('intro')}</p>
        </div>
        <span className={styles['headActions']}>
          <button
            type="button"
            className={styles['secondaryButton']}
            title={t('refreshHint')}
            disabled={busy || state.status === 'loading'}
            onClick={() => { run(() => controller.load()) }}
          >
            {state.status === 'loading' ? t('refreshing') : t('refresh')}
          </button>
          <button
            type="button"
            className={styles['primaryButton']}
            disabled={!state.writable || busy}
            onClick={() => { beginNew() }}
          >
            {t('add')}
          </button>
        </span>
      </div>
      {state.writable ? null : <p className={styles['notice']}>{t('readOnly')}</p>}
      {writeError === undefined ? null : <p role="alert" className={styles['error']}>{writeError}</p>}
      {state.status === 'ready' && state.servers.length === 0 && editing?.mode !== 'new'
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['rows']}>
            {state.servers.map(server => (
              editing?.mode === 'edit' && editing.id === server.id
                ? (
                  <li key={server.id} className={styles['row']}>
                    <ServerEditor
                      server={server}
                      template={undefined}
                      busy={busy}
                      t={t}
                      onCancel={() => { setEditing(undefined) }}
                      onSubmit={(input) => {
                        run(async () => {
                          const failure = await controller.upsert(input)
                          if (failure === undefined) setEditing(undefined)
                          return failure
                        })
                      }}
                    />
                  </li>
                )
                : (
                  <ServerRow
                    key={server.id}
                    server={server}
                    writable={state.writable}
                    busy={busy}
                    confirming={confirming === server.id}
                    t={t}
                    onToggle={(disabled) => { run(() => controller.setDisabled(server.id, disabled)) }}
                    onReconnect={() => { run(() => controller.reconnect(server.id)) }}
                    onEdit={() => { setConfirming(undefined); setEditing({ mode: 'edit', id: server.id }) }}
                    onRemove={() => {
                      if (confirming !== server.id) {
                        setConfirming(server.id)
                        return
                      }
                      setConfirming(undefined)
                      run(() => controller.remove(server.id))
                    }}
                    onCancelRemove={() => { setConfirming(undefined) }}
                  />
                )
            ))}
            {editing?.mode === 'new'
              ? (
                <li key={`new:${editing.request}`} ref={newEditor} className={styles['row']}>
                  <ServerEditor
                    server={undefined}
                    template={editing.template}
                    busy={busy}
                    t={t}
                    onCancel={() => { setEditing(undefined) }}
                    onSubmit={(input) => {
                      run(async () => {
                        const failure = await controller.upsert(input)
                        if (failure === undefined) setEditing(undefined)
                        return failure
                      })
                    }}
                  />
                </li>
              )
              : null}
          </ul>
        )}
      <TemplatesBlock
        templates={state.templates}
        writable={state.writable}
        busy={busy}
        servers={state.servers}
        t={t}
        onAdd={beginNew}
        onRetry={() => { void controller.loadTemplates() }}
      />
    </div>
  )
}
