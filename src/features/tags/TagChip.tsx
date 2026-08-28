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

export const TagChip = ({ tag, className }: { tag: TagDefinition; className?: string }) => {
  if (tag.displayType === 'emoji') {
    return (
      <span
        className={cn('inline-flex items-center justify-center text-base leading-none', className)}
        title={tag.name}
        aria-label={tag.name}
      >
        {tag.emoji || tag.name}
      </span>
    )
  }

  const backgroundColor = tag.color || '#d9c9b8'
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap', className)}
      style={{ backgroundColor, color: getContrastingTextColor(backgroundColor) }}
      title={tag.name}
    >
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
