/**
 * Plugin-local icon set in the dsh web UI glyph style (ic_ds_*): monochrome
 * filled paths, `fill="currentColor"`, square viewBox, {size, className}
 * props. Path data for the pause/check/trash glyphs mirrors the core
 * `@deepseek-ai/dsh-client-ui-primitives` icons so the panel keeps the
 * design-system look without cross-plugin value imports.
 * @module
 */

export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

/** ic_ds_clock_outline_16: ring + 10:10 rounded hands (design-system style). */
export const IconClockOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8 0.45C12.17 0.45 15.55 3.83 15.55 8C15.55 12.17 12.17 15.55 8 15.55C3.83 15.55 0.45 12.17 0.45 8C0.45 3.83 3.83 0.45 8 0.45ZM8 1.95C4.65817 1.95 1.95 4.65817 1.95 8C1.95 11.3418 4.65817 14.05 8 14.05C11.3418 14.05 14.05 11.3418 14.05 8C14.05 4.65817 11.3418 1.95 8 1.95Z"
      fill="currentColor"
    />
    <rect x="7.6" y="7.6" width="4.7" height="0.8" rx="0.4" transform="rotate(-30 8 8)" fill="currentColor" />
    <rect x="7.6" y="7.6" width="3.3" height="0.8" rx="0.4" transform="rotate(-145 8 8)" fill="currentColor" />
    <circle cx="8" cy="8" r="0.75" fill="currentColor" />
  </svg>
)

/** ic_ds_pause_outline_16 (mirrors @deepseek-ai/dsh-client-ui-primitives). */
export const IconPauseOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M14.1448 8.00024C14.1448 4.60644 11.394 1.85563 8.00024 1.85563C4.60644 1.85563 1.85563 4.60644 1.85563 8.00024C1.85563 11.394 4.60644 14.1448 8.00024 14.1448C11.394 14.1448 14.1448 11.394 14.1448 8.00024ZM15.5112 8.00024C15.5112 12.1482 12.1482 15.5112 8.00024 15.5112C3.85226 15.5112 0.489258 12.1482 0.489258 8.00024C0.489258 3.85226 3.85226 0.489258 8.00024 0.489258C12.1482 0.489258 15.5112 3.85226 15.5112 8.00024Z"
      fill="currentColor"
    />
    <path d="M7.14244 5.14258V10.8569H5.71387V5.14258H7.14244Z" fill="currentColor" />
    <path d="M10.286 5.14258V10.8569H8.85742V5.14258H10.286Z" fill="currentColor" />
  </svg>
)

/** ic_ds_check_outline_14 (mirrors @deepseek-ai/dsh-client-ui-primitives). */
export const IconCheckOutline14 = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11.5635 4.58984L7.61426 9.07715C7.35154 9.37561 7.11346 9.64812 6.89453 9.84668C6.66593 10.054 6.38519 10.2506 6.01465 10.3164C5.82079 10.3508 5.62207 10.3529 5.42773 10.3213C5.0561 10.2609 4.77266 10.0674 4.54102 9.86328C4.31926 9.66791 4.07752 9.39911 3.81055 9.10449L2.44531 7.59863L3.55664 6.59082L4.92188 8.09766C5.21256 8.41844 5.38878 8.61191 5.53223 8.73828C5.61022 8.80699 5.65253 8.83192 5.66895 8.83984C5.69648 8.84429 5.72449 8.84467 5.75195 8.83984C5.72657 8.84451 5.75564 8.85422 5.88672 8.73535C6.02833 8.60692 6.20225 8.41088 6.48828 8.08594L10.4385 3.59961L11.5635 4.58984Z"
      fill="currentColor"
    />
  </svg>
)
