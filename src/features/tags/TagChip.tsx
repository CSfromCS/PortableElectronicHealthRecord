import type { TagDefinition } from '@/types'
import { cn } from '@/lib/utils'
import { renderTagDisplayText } from './tagUtils'

const getContrastingTextColor = (backgroundColor: string): string => {
  const hex = backgroundColor.replace('#', '')
  if (hex.length !== 6) return '#1a1a1a'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}

export type TagChipRoleMarker = 'M' | 'R'

const ROLE_MARKER_LABELS: Record<TagChipRoleMarker, string> = {
  M: 'Main',
  R: 'Referral',
}

const RoleMarkerBadge = ({ roleMarker }: { roleMarker: TagChipRoleMarker }) => (
  <span
    className='inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-black/20 text-[9px] font-bold leading-none'
    aria-hidden='true'
  >
    {roleMarker}
  </span>
)

export const TagChip = ({ tag, className, roleMarker }: { tag: TagDefinition; className?: string; roleMarker?: TagChipRoleMarker }) => {
  const title = roleMarker ? `${ROLE_MARKER_LABELS[roleMarker]}: ${tag.name}` : tag.name

  if (tag.displayType === 'emoji') {
    return (
      <span
        className={cn('inline-flex items-center gap-0.5 text-base leading-none', className)}
        title={title}
        aria-label={title}
      >
        {roleMarker ? <RoleMarkerBadge roleMarker={roleMarker} /> : null}
        {tag.emoji || tag.name}
      </span>
    )
  }

  const backgroundColor = tag.color || '#d9c9b8'
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap', className)}
      style={{ backgroundColor, color: getContrastingTextColor(backgroundColor) }}
      title={title}
    >
      {roleMarker ? <RoleMarkerBadge roleMarker={roleMarker} /> : null}
      {renderTagDisplayText(tag)}
    </span>
  )
}

export const TagChipRow = ({ tags, className }: { tags: TagDefinition[]; className?: string }) => {
  if (tags.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-1', className)}>
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </div>
  )
}
