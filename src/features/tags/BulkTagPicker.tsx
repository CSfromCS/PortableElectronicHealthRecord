import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TagDefinition, TagGroupDefinition } from '@/types'
import { bucketTagsByGroup } from './tagUtils'
import { TagChip, TagChipRow } from './TagChip'

const UNGROUPED_KEY = -1

/** Grouped multi-select tag picker with no per-patient applied state — used for bulk add/remove across a set of selected patients. */
export const BulkTagPicker = ({
  tags,
  groups,
  selectedTagIds,
  onToggle,
  collapsible = false,
}: {
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  selectedTagIds: Set<number>
  onToggle: (tag: TagDefinition) => void
  /** When true, each Tag Group section starts collapsed to a read-only row of its currently
   * selected tags — same idea as the Profile tab's applied-tags view (collapsed once there's
   * something to summarize, expanded when there's nothing selected yet to pick from). Click the
   * header to toggle either way regardless of the starting state. Off by default so existing
   * callers (Custom Actions conditions, Custom Views) keep today's always-expanded behavior. */
  collapsible?: boolean
}) => {
  const buckets = bucketTagsByGroup(tags, groups)
  const bucketKey = (bucket: { groupId: number | null }) => bucket.groupId ?? UNGROUPED_KEY

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set(
    buckets
      .filter((bucket) => !bucket.tags.some((tag) => tag.id !== undefined && selectedTagIds.has(tag.id)))
      .map(bucketKey),
  ))
  const toggleExpanded = (key: number) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (tags.length === 0) {
    return <p className='text-xs text-clay'>No tags defined yet. Create tags in Settings → Manage Tags.</p>
  }

  return (
    <div className='space-y-4'>
      {buckets.map((bucket) => {
        const key = bucketKey(bucket)
        const selectedTags = bucket.tags.filter((tag) => tag.id !== undefined && selectedTagIds.has(tag.id))
        const isExpanded = !collapsible || expandedGroups.has(key)

        return (
          <div key={key} className='space-y-1.5'>
            {collapsible ? (
              <button
                type='button'
                className='flex w-full items-center gap-1.5 text-left'
                aria-expanded={isExpanded}
                onClick={() => toggleExpanded(key)}
              >
                {isExpanded ? (
                  <ChevronDown className='h-3.5 w-3.5 shrink-0 text-clay' aria-hidden='true' />
                ) : (
                  <ChevronRight className='h-3.5 w-3.5 shrink-0 text-clay' aria-hidden='true' />
                )}
                <span className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>{bucket.groupName}</span>
                {!isExpanded && selectedTags.length > 0 ? <TagChipRow tags={selectedTags} className='justify-start' /> : null}
              </button>
            ) : (
              <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>{bucket.groupName}</p>
            )}
            {isExpanded ? (
              <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
                {bucket.tags.map((tag) => {
                  const checked = tag.id !== undefined && selectedTagIds.has(tag.id)
                  return (
                    <label key={tag.id} className='flex items-center gap-2.5 py-1 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={checked}
                        onChange={() => onToggle(tag)}
                        aria-label={`Toggle tag ${tag.name}`}
                      />
                      <TagChip tag={tag} />
                      <span className='text-sm text-espresso'>{tag.name}</span>
                    </label>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
