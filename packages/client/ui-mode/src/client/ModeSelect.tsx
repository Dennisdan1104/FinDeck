/**
 * The mode selector: a compact menu over the preset roster, showing the
 * session's current mode and switching through the injected `/mode` channel.
 * The current value is the host-computed `mode` projection, never client
 * optimism; a pick that fails snaps back on the next projection frame. The
 * composer seat (`ComposerModeSelect`) also carries the session-level AI-cluster
 * toggle, which a free mode alone shows: a work mode declares its cluster per
 * flow step instead. A pick the composed skill-forge intake claims opens that
 * flow's session picker and switches nothing here.
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
// Type-only: pulls the ui-conversation SlotMap merge (the input.mode seat and
// its {locked} owner share) and the `mode` projection key.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the global `useWorkspaces` standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-mode/client'
import { IconBranchOutlineMedium, IconChevronDownOutlineRegular, IconWarningOutlineMedium, Menu, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModeUiInjected } from './index.ts'
import type { RosterRead } from './index.ts'
import css from './ModeSelect.module.css'

/** One roster row the selector renders. */
export interface ModeRow {
  /** Preset id, written to the switch command. */
  readonly id: string
  /** Display name the preset published; falls back to the id. */
  readonly name: string
  /** Mode classification the preset declared; `free` when absent. */
  readonly modeKind: 'work' | 'free'
  /** Layer the row was read from; `global` when the read marked none. */
  readonly scope: 'global' | 'project'
}

/** The roster rows as the selector renders them: healthy presets only. */
export function modeRows(roster: AgentPresetRoster): ModeRow[] {
  return roster.presets
    .filter(preset => preset.broken === undefined)
    .map(preset => ({
      id: preset.id,
      name: preset.name ?? preset.id,
      modeKind: preset.modeKind === 'work' ? 'work' : 'free',
      scope: preset.scope === 'project' ? 'project' : 'global',
    }))
}

/**
 * The bare preset id one projected identity names.
 *
 * A session composed from a project preset records the layer-qualified
 * identity `project:<projectDir>:<id>` (and `global:<id>` for a global one),
 * which no roster row spells. The id is the segment after the LAST colon,
 * because a Windows project directory carries a drive colon of its own; an
 * identity with no layer prefix is already a bare id. This mirrors the Host's
 * own rule (agent-presets `presetIdOf`).
 * @param identity - a preset id, or a layer-qualified preset identity.
 * @returns the preset's own id.
 */
export function barePresetId(identity: string): string {
  if (identity.startsWith('global:')) return identity.slice('global:'.length)
  if (identity.startsWith('project:')) {
    const rest = identity.slice('project:'.length)
    const at = rest.lastIndexOf(':')
    if (at > 0 && at < rest.length - 1) return rest.slice(at + 1)
  }
  return identity
}

/**
 * Full mode-seat component props: runtime share (standard kit + locked owner) &
 * injected share & the locale seat, plus the composer's free-mode AI-cluster
 * toggle opt-in — the title-bar seat renders the bare selector.
 */
export type ModeSelectProps =
  PropsRuntime<'conversation.input.mode'> & InjectFace<ModeUiInjected> & PropsLocale<'mode'> & {
    /** Render the session-level AI-cluster toggle beside the selector. */
    readonly cluster?: boolean
  }

/**
 * The composer seat: the shared selector plus the session-level AI-cluster
 * toggle.
 * @param props - composed slot props.
 * @returns both controls, or whatever the bare selector renders.
 */
export function ComposerModeSelect(props: ModeSelectProps) {
  return <ModeSelect {...props} cluster />
}

/**
 * Render a mode selector.
 * @param props - composed slot props.
 * @returns the selector, or null while the deployment composes no presets.
 */
export function ModeSelect({ useProjection, useWorkspaces, sessionId, locked, loadRoster, switchMode, setCluster, openForge, cluster = false, t }: ModeSelectProps) {
  const mode = useProjection('mode')
  // The session's project is the workspace accounting it (a session's cwd is
  // that workspace's path), which is what selects the project preset layer the
  // roster read includes. Absent (an ungrouped session) reads the global layer.
  const cwd = useWorkspaces(state => state.items.find(item => item.sessionIds.includes(sessionId))?.path)
  const [rows, setRows] = useState<ModeRow[] | null>(null)
  const [open, setOpen] = useState(false)
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void loadRoster(cwd).then((read: RosterRead) => {
      if (!alive) return
      setRows(read.ok ? modeRows(read.value) : [])
    })
    return () => { alive = false }
  }, [loadRoster, cwd])

  // No roster or no projection frame yet: the seat renders nothing rather
  // than a control that cannot act.
  if (rows === null || mode === undefined || mode.mode === null) return null
  // A project session records a layer-qualified identity; the row it marks is
  // the one whose bare id matches, and the switch stays addressed by bare id.
  const currentId = barePresetId(mode.mode)
  const options = rows.filter(row => row.id !== currentId)
  const current = rows.find(row => row.id === currentId)
  const label = current?.name ?? currentId
  const projectScoped = current?.scope === 'project' || mode.mode.startsWith('project:')
  // A work mode declares its cluster per flow step, so the session-level toggle
  // belongs to a free mode only; a mode no roster row names reads as free, the
  // same way the flow strip reads it.
  const showCluster = cluster && (current === undefined || current.modeKind === 'free')
  const clusterOn = mode.cluster

  return (
    <>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options.map(row => ({
          id: row.id,
          label: `${row.name} · ${row.modeKind === 'work' ? t('select.kindWork') : t('select.kindFree')}`,
        }))}
        selectedId={currentId}
        onSelect={(id) => {
          setOpen(false)
          // The skill-forge intake owns its own mode: its pick opens the
          // session picker that creates the forge session, so this one keeps
          // the mode it already runs.
          if (openForge(id)) return
          void switchMode(sessionId, id).then((failure) => {
            if (failure === null) return
            toastSeq.current += 1
            // The host refusal names the raw write handle; the user can only
            // close the other instance, so the message says that instead.
            const text = failure.includes('already owned by an active write handle')
              ? t('select.alreadyOwned')
              : `${t('select.switchFailed')}：${failure}`
            setToast({ seq: toastSeq.current, text })
          })
        }}
        align="start"
        portal
        anchor={(
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open}
            title={t('select.hint')}
            disabled={locked}
            onClick={() => { setOpen(value => !value) }}
          >
            {label}
            {projectScoped ? <span className={css.badge}>{t('select.projectBadge')}</span> : null}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
      {showCluster && (
        <button
          type="button"
          className={css.cluster}
          data-on={clusterOn}
          aria-pressed={clusterOn}
          aria-label={t('input.cluster')}
          title={clusterOn ? t('input.clusterTurnOff') : t('input.clusterTurnOn')}
          disabled={locked}
          onClick={() => {
            void setCluster(sessionId, !clusterOn).then((failure) => {
              if (failure === null) return
              toastSeq.current += 1
              setToast({ seq: toastSeq.current, text: `${t('input.clusterFailed')}：${failure}` })
            })
          }}
        >
          <IconBranchOutlineMedium size={14} className={css.clusterIcon} />
          {t('input.cluster')}
        </button>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineMedium />}
          holdMs={6000}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}
