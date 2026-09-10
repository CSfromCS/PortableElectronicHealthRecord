import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TagDefinition, TagGroupDefinition } from '@/types'
import { bucketTagsByGroup, type TagGroupBucket } from './tagUtils'
import { TagChip, TagChipRow } from './TagChip'

const BulkTagPickerGroups = ({
  buckets,
  selectedTagIds,
  onToggle,
}: {
  buckets: TagGroupBucket[]
  selectedTagIds: Set<number>
  onToggle: (tag: TagDefinition) => void
}) => (
  <div className='space-y-4'>
    {buckets.map((bucket) => (
      <div key={bucket.groupId ?? 'ungrouped'} className='space-y-1.5'>
        <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>{bucket.groupName}</p>
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
      </div>
    ))}
  </div>
)

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
  /** When true, the whole picker (every Tag Group together) starts collapsed to a single read-only
   * summary row of every currently selected tag if there's already something to summarize, or
   * expanded if there's nothing selected yet to pick from — same idea as the Profile tab's
   * applied-tags view. One click toggles everything together; there's no per-Tag-Group collapse.
   * Off by default so existing callers (Custom Actions conditions, Custom Views) keep today's
   * always-expanded behavior. */
  collapsible?: boolean
}) => {
  const buckets = bucketTagsByGroup(tags, groups)
  const [expanded, setExpanded] = useState(() => selectedTagIds.size === 0)

  if (tags.length === 0) {
    return <p className='text-xs text-clay'>No tags defined yet. Create tags in Settings → Manage Tags.</p>
  }

  if (!collapsible) return <BulkTagPickerGroups buckets={buckets} selectedTagIds={selectedTagIds} onToggle={onToggle} />

  const selectedTags = tags.filter((tag) => tag.id !== undefined && selectedTagIds.has(tag.id))

  return (
    <div className='space-y-2'>
      <button
        type='button'
        className='flex w-full items-center gap-1.5 text-left'
        aria-expanded={expanded}
        onClick={() => setExpanded((previous) => !previous)}
      >
        {expanded ? (
          <ChevronDown className='h-3.5 w-3.5 shrink-0 text-clay' aria-hidden='true' />
        ) : (
          <ChevronRight className='h-3.5 w-3.5 shrink-0 text-clay' aria-hidden='true' />
        )}
        <span className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Tags</span>
        {!expanded && selectedTags.length > 0 ? <TagChipRow tags={selectedTags} className='justify-start' /> : null}
      </button>
      {expanded ? <BulkTagPickerGroups buckets={buckets} selectedTagIds={selectedTagIds} onToggle={onToggle} /> : null}
    </div>
  )
}
