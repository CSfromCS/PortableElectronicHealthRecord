import { Plus, Trash2 } from 'lucide-react'
import { ArrowUpNarrowWide, ArrowDownWideNarrow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder, dropIndicatorClassName } from '@/lib/dnd/useDragReorder'
import { cn } from '@/lib/utils'
import { FieldTip } from '@/lib/tips/FieldTip'
import type { TagDefinition, TagGroupDefinition } from '@/types'
import { TagChip } from '@/features/tags/TagChip'
import {
  PATIENT_SORT_FIELDS,
  PATIENT_SORT_FIELD_LABELS,
  createPatientSortLevel,
  createPatientSortLevelId,
  type PatientSortConfig,
  type PatientSortDirection,
  type PatientSortField,
  type PatientSortLevel,
} from './patientSort'

const SortDirectionToggle = ({ direction, onToggle }: { direction: PatientSortDirection; onToggle: () => void }) => (
  <Button
    type='button'
    variant='outline'
    size='sm'
    className='h-7 w-7 shrink-0 p-0'
    aria-label={direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
    onClick={onToggle}
  >
    {direction === 'asc' ? <ArrowUpNarrowWide className='h-3.5 w-3.5' aria-hidden='true' /> : <ArrowDownWideNarrow className='h-3.5 w-3.5' aria-hidden='true' />}
  </Button>
)

/** The nested "which tags, in what priority order" editor shown under a level once its field is
 * set to Tag order — its own component (rather than inline in the level row) so it can hold its
 * own useDragReorder instance regardless of how many tagOrder levels happen to be present. */
const TagOrderLevelEditor = ({
  level,
  tags,
  onChange,
}: {
  level: Extract<PatientSortLevel, { field: 'tagOrder' }>
  tags: TagDefinition[]
  onChange: (tagIds: number[]) => void
}) => {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag] as const))
  const orderedTags = level.tagIds.map((tagId) => tagsById.get(tagId)).filter((tag): tag is TagDefinition => tag !== undefined)
  const availableTags = tags.filter((tag) => tag.id !== undefined && !level.tagIds.includes(tag.id))

  const reorder = (sourceTagId: number, targetTagId: number, position: 'before' | 'after') => {
    onChange(moveItemByKey(level.tagIds, (id) => id, sourceTagId, targetTagId, position))
  }
  const tagDrag = useDragReorder(level.tagIds, reorder)

  const removeTag = (tagId: number) => onChange(level.tagIds.filter((id) => id !== tagId))
  const addTag = (tagId: number) => onChange([...level.tagIds, tagId])

  return (
    <div className='ml-8 mt-1.5 space-y-1.5 rounded-lg border border-clay/20 bg-warm-ivory px-2.5 py-2'>
      <FieldTip>Patients with the earliest-listed tag sort first; patients with none of these tags sort last.</FieldTip>
      {orderedTags.length > 0 ? (
        <ul className='space-y-1'>
          {orderedTags.map((tag) => (
            <li
              key={tag.id}
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-clay/15 bg-white/70 px-1.5 py-1',
                dropIndicatorClassName(tagDrag.dropIndicator(tag.id as number)),
              )}
              {...tagDrag.getItemProps(tag.id as number)}
            >
              <DragHandle label={`Drag to reorder ${tag.name}`} dragProps={tagDrag.getHandleProps(tag.id as number)} />
              <TagChip tag={tag} />
              <span className='flex-1 text-sm text-espresso'>{tag.name}</span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-6 w-6 shrink-0 p-0 text-action-danger'
                aria-label={`Remove ${tag.name} from tag order`}
                onClick={() => removeTag(tag.id as number)}
              >
                <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {availableTags.length > 0 ? (
        <Select value='' onValueChange={(value) => addTag(Number.parseInt(value, 10))}>
          <SelectTrigger className='h-7 text-xs px-2'><SelectValue placeholder='Add a tag…' /></SelectTrigger>
          <SelectContent>
            {availableTags.map((tag) => (
              <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}

export const PatientSortConfigDialog = ({
  open,
  onOpenChange,
  config,
  onChange,
  tags,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: PatientSortConfig
  onChange: (config: PatientSortConfig) => void
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
}) => {
  const setLevels = (levels: PatientSortLevel[]) => onChange({ levels })

  const addLevel = () => {
    const usedFields = new Set(config.levels.map((level) => level.field))
    const nextField = PATIENT_SORT_FIELDS.find((field) => !usedFields.has(field)) ?? 'room'
    setLevels([...config.levels, createPatientSortLevel(nextField, createPatientSortLevelId(), 'asc')])
  }

  const removeLevel = (id: string) => setLevels(config.levels.filter((level) => level.id !== id))

  const updateLevelField = (id: string, field: PatientSortField) => {
    setLevels(config.levels.map((level) => (level.id === id ? createPatientSortLevel(field, level.id, level.direction) : level)))
  }

  const updateLevelDirection = (id: string, direction: PatientSortDirection) => {
    setLevels(config.levels.map((level) => (level.id === id ? { ...level, direction } : level)))
  }

  const updateTagOrderTagIds = (id: string, tagIds: number[]) => {
    setLevels(config.levels.map((level) => (level.id === id && level.field === 'tagOrder' ? { ...level, tagIds } : level)))
  }

  const reorderLevels = (sourceId: string, targetId: string, position: 'before' | 'after') => {
    setLevels(moveItemByKey(config.levels, (level) => level.id, sourceId, targetId, position))
  }
  const levelDrag = useDragReorder(config.levels.map((level) => level.id), reorderLevels)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Sort patients</DialogTitle>
        </DialogHeader>
        <FieldTip className='-mt-2'>
          Shared by the Patients list, Master Checklist, and the Reports patient picker — changing it here updates all three. Each level only breaks ties left by the one above it.
        </FieldTip>
        <ScrollArea className='max-h-[60vh] pr-3'>
          <div className='space-y-2'>
            {config.levels.map((level, index) => (
              <div key={level.id}>
                <div
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border border-clay/20 bg-warm-ivory px-2 py-1.5',
                    dropIndicatorClassName(levelDrag.dropIndicator(level.id)),
                  )}
                  {...levelDrag.getItemProps(level.id)}
                >
                  <DragHandle label={`Drag to reorder sort level ${index + 1}`} dragProps={levelDrag.getHandleProps(level.id)} />
                  <Select value={level.field} onValueChange={(value) => updateLevelField(level.id, value as PatientSortField)}>
                    <SelectTrigger className='h-7 flex-1 text-xs px-2'><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PATIENT_SORT_FIELDS.map((field) => (
                        <SelectItem key={field} value={field}>{PATIENT_SORT_FIELD_LABELS[field]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <SortDirectionToggle direction={level.direction} onToggle={() => updateLevelDirection(level.id, level.direction === 'asc' ? 'desc' : 'asc')} />
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 w-7 shrink-0 p-0 text-action-danger'
                    aria-label={`Remove sort level ${index + 1}`}
                    onClick={() => removeLevel(level.id)}
                  >
                    <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                </div>
                {level.field === 'tagOrder' ? (
                  <TagOrderLevelEditor level={level} tags={tags} onChange={(tagIds) => updateTagOrderTagIds(level.id, tagIds)} />
                ) : null}
              </div>
            ))}
            {config.levels.length === 0 ? (
              <p className='py-3 text-center text-sm text-clay'>No sort levels — add one below.</p>
            ) : null}
          </div>
        </ScrollArea>
        <div className='flex justify-between gap-2 pt-2'>
          <Button type='button' variant='outline' size='sm' className='gap-1' onClick={addLevel}>
            <Plus className='h-3.5 w-3.5' aria-hidden='true' />
            Add level
          </Button>
          <Button type='button' onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
