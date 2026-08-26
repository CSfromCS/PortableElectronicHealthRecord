import type { Patient, TagDefinition, TagGroupDefinition } from '@/types'
import { bucketTagsByGroup } from './tagUtils'
import { TagChip } from './TagChip'

export const TagPicker = ({
  patient,
  tags,
  groups,
  onToggle,
}: {
  patient: Patient
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onToggle: (tag: TagDefinition) => void
}) => {
  const buckets = bucketTagsByGroup(tags, groups)
  const appliedTagIds = new Set(patient.tagIds ?? [])

  if (tags.length === 0) {
    return <p className='text-xs text-clay'>No tags defined yet. Create tags in Settings → Manage Tags.</p>
  }

  return (
    <div className='space-y-4'>
      {buckets.map((bucket) => (
        <div key={bucket.groupId ?? 'ungrouped'} className='space-y-1.5'>
          <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>{bucket.groupName}</p>
          <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
            {bucket.tags.map((tag) => {
              const applied = tag.id !== undefined && appliedTagIds.has(tag.id)
              return (
                <label key={tag.id} className='flex items-center gap-2.5 py-1 cursor-pointer'>
                  <input
                    type='checkbox'
                    className='h-4 w-4 accent-action-primary'
                    checked={applied}
                    onChange={() => onToggle(tag)}
                    aria-label={`Toggle tag ${tag.name}`}
                  />
                  <TagChip tag={tag} />
                  <span className='text-sm text-espresso'>{tag.name}</span>
                  {tag.terminal ? <span className='text-[10px] text-clay/70 ml-auto'>Terminal</span> : null}
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
