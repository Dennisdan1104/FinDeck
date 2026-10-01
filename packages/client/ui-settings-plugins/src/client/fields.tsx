/**
 * Hand-written controls for the plugin configuration forms. Each renders one
 * field's label, its staged text, whether saving would leave an override, and
 * — when one stands — the reset that stages a clear back to the composition
 * layer. Nothing here writes: a control reports what the user typed, and the
 * card's save is the single point where a draft becomes a document mutation.
 */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './fields.module.css'

/** What every field control needs regardless of its value type. */
export interface FieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders. */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the draft is not a value this field accepts. */
  invalid: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string
  /** Disables every control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(props: FieldProps & {
  /** Hints a numeric keypad without narrowing what the control accepts. */
  numeric?: boolean
  /** Placeholder shown while the draft is empty. */
  placeholder?: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? css.inputInvalid : css.input}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.invalid ? { 'aria-invalid': true } : {}}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/**
 * A write-only credential control. The value never rides a response, so the
 * control reports only whether one is configured and starts blank; a blank
 * draft writes nothing, which keeps the stored key rather than clearing it.
 * @param props - the field's copy, its staged text, and the configured state.
 * @returns the labelled control.
 */
export function SecretField(props: Pick<FieldProps, 'id' | 'label' | 'hint' | 'text' | 'disabled' | 'onEdit'> & {
  /** Whether the Host reports a configured credential for this reference. */
  configured: boolean
  /** Copy describing the configured state. */
  stateLabel: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        <span className={css.badges}>
          <span className={props.configured ? css.badge : css.badgeMuted}>{props.stateLabel}</span>
        </span>
      </div>
      <input
        id={props.id}
        className={css.input}
        type="password"
        autoComplete="off"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}

/**
 * A staged boolean control rendered as a switch. Its draft is the text `true`
 * or `false`, so it stages through the same form as every other control and
 * shows the same override badge and reset.
 * @param props - the field's copy, its staged state, and the edit actions.
 * @returns the labelled switch.
 */
export function ToggleField(props: Pick<FieldProps, 'id' | 'label' | 'hint' | 'overridden' | 'overriddenLabel'
  | 'resetLabel' | 'disabled' | 'onReset'> & {
  /** The staged boolean. */
  checked: boolean
  /** Stage the opposite literal. */
  onToggle: () => void
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <button
        id={props.id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        className={clsx(css.switch, props.checked && css.switchOn)}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        <span className={css.thumb} />
      </button>
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}

/**
 * A value the user reads but this surface does not edit — a deployment fact
 * whose switch requires a capability the running host does not offer. It renders
 * as the same labelled row as an editable field, minus the control.
 * @param props - the row's copy and its resolved value text.
 * @returns the labelled read-only row.
 */
export function ReadOnlyField(props: {
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the value. */
  hint: string
  /** The effective value, already localized when it stands for an absence. */
  value: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.label}>{props.label}</span>
      </div>
      <p className={css.readOnlyValue}>{props.value}</p>
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}

/**
 * A collapsed region holding the controls that do not fit the card's main
 * fields. Collapsing is a reading gesture, so it is local disclosure state and
 * never reaches the form: drafts staged inside stay staged while it is closed.
 * @param props - the disclosure's summary copy and its controls.
 * @returns the collapsed region.
 */
export function FoldSection(props: {
  /** Summary text shown while collapsed. */
  label: string
  /** The controls disclosed by the region. */
  children: ReactNode
}) {
  return (
    <details className={css.fold}>
      <summary className={css.foldSummary}>{props.label}</summary>
      <div className={css.foldBody}>{props.children}</div>
    </details>
  )
}
