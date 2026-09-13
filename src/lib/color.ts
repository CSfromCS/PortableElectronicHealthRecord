/** Picks black or white text for readable contrast against a `#rrggbb` background — shared by
 * TagChip and any other badge/chip that colors its own background from a stored hex value. */
export const getContrastingTextColor = (backgroundColor: string): string => {
  const hex = backgroundColor.replace('#', '')
  if (hex.length !== 6) return '#1a1a1a'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}

/** A small fixed palette for coloring top-level Master Problems — no color picker in this phase,
 * just a deterministic assignment (by problem id) so the same problem always gets the same color
 * across renders, and sub-problems can inherit their parent's. */
const MASTER_PROBLEM_PALETTE = [
  '#82d0f7', '#c975f0', '#f2a65a', '#7fd0a0', '#f28b8b', '#a8b5f7', '#f2d16b', '#8ae0d6',
]

export const getMasterProblemColor = (masterProblemId: number): string =>
  MASTER_PROBLEM_PALETTE[Math.abs(masterProblemId) % MASTER_PROBLEM_PALETTE.length]
