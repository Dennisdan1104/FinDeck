import type { IconProps } from './icons/props.ts'

/** Square design space of {@link MARK_PATH}, matching the other product icons. */
const MARK_VIEWBOX = 24

/**
 * The rising sparkline: the desktop icon's four-point polyline
 * (`apps/desktop/assets/generate-icons.py`) scaled from that script's
 * 256-unit design space — left-low to right-high with one pullback, so the
 * mark reads as a chart that rises.
 */
const MARK_PATH = 'M4.13 16.69L9.94 11.25L13.88 14.44L19.5 6.56'

/** Stroke width the polyline carries in this viewBox (the desktop icon's 28/256). */
const MARK_STROKE = 2.63

/**
 * Render the FinDeck mark: a square, current-color rising sparkline.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement; color rides currentColor.
 * @returns the mark svg (aria-hidden decorative brand art).
 */
export function FinDeckMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={MARK_PATH}
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
