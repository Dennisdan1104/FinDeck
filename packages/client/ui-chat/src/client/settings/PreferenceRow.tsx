/** Localized two-column selector shared by Chat preference rows. */
import { useRef, useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PreferenceRow.module.css'

/**
 * Render a preference label and its menu; selection restores focus to the
 * selector before publishing the new value, so the row survives the option
 * list unmounting under the reader's own open choice.
 * @param props - localized copy, selected value, choices, and mutation callback.
 * @param props.title - row title.
 * @param props.description - row description.
 * @param props.value - currently selected option id.
 * @param props.selectedLabel - already-localized label of {@link props.value}.
 * @param props.options - selectable option ids with already-localized labels.
 * @param props.onSelect - receives the newly selected option id.
 * @returns the settings row.
 */
export function PreferenceRow({ title, description, value, selectedLabel, options, onSelect }: {
  title: string
  description: string
  value: string
  selectedLabel: string
  options: readonly { id: string; label: string }[]
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectorRef = useRef<HTMLButtonElement>(null)
  const closeMenu = () => { setOpen(false) }
  const selectMode = (id: string) => {
    selectorRef.current?.focus({ preventScroll: true })
    closeMenu()
    onSelect(id)
  }
  const selector = (
    <button
      ref={selectorRef}
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {selectedLabel}
      <IconChevronDownOutlineRegular className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={options}
        selectedId={value}
        onSelect={selectMode}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
