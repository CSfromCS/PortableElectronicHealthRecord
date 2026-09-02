import { useState, type DragEvent, type TouchEvent } from 'react'
import { ChevronLeft, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import type {
  CustomAction,
  CustomActionCondition,
  CustomActionTagEffect,
  CustomActionTriggerType,
  TagDefinition,
  TagGroupDefinition,
} from '@/types'
import { createCustomActionConditionId } from './customActionConstants'
import { BulkTagPicker } from '@/features/tags/BulkTagPicker'
import { TagChip } from '@/features/tags/TagChip'
import { bucketTagsByGroup } from '@/features/tags/tagUtils'

type ChecklistItemDraft = { id: string; text: string }

type ConditionFormState = {
  id: string
  requiredTagIds: number[]
  checklistItems: ChecklistItemDraft[]
  tagEffects: CustomActionTagEffect[]
}

type CustomActionFormState = {
  name: string
  triggerType: CustomActionTriggerType
  triggerTagId: string
  /** Applied to every triggered patient unconditionally — no condition needs to be defined for this to run. */
  checklistItems: ChecklistItemDraft[]
  tagEffects: CustomActionTagEffect[]
  conditions: ConditionFormState[]
}

const createChecklistItemId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const blankCondition = (): ConditionFormState => ({
  id: createCustomActionConditionId(),
  requiredTagIds: [],
  checklistItems: [],
  tagEffects: [],
})

const blankCustomActionForm = (): CustomActionFormState => ({
  name: '',
  triggerType: 'manual',
  triggerTagId: '',
  checklistItems: [],
  tagEffects: [],
  conditions: [],
})

const conditionToForm = (condition: CustomActionCondition): ConditionFormState => ({
  id: condition.id,
  requiredTagIds: [...condition.requiredTagIds],
  checklistItems: condition.checklistItems.map((text) => ({ id: createChecklistItemId(), text })),
  tagEffects: condition.tagEffects.map((effect) => ({ ...effect })),
})

const actionToForm = (action: CustomAction): CustomActionFormState => ({
  name: action.name,
  triggerType: action.triggerType,
  triggerTagId: action.triggerTagId !== undefined ? String(action.triggerTagId) : '',
  checklistItems: action.checklistItems.map((text) => ({ id: createChecklistItemId(), text })),
  tagEffects: action.tagEffects.map((effect) => ({ ...effect })),
  conditions: action.conditions.map(conditionToForm),
})

const formChecklistItemsToStrings = (items: ChecklistItemDraft[]): string[] =>
  items.map((item) => item.text.trim()).filter((text) => text.length > 0)

const formToConditions = (conditions: ConditionFormState[]): CustomActionCondition[] =>
  conditions.map((condition) => ({
    id: condition.id,
    requiredTagIds: condition.requiredTagIds,
    checklistItems: formChecklistItemsToStrings(condition.checklistItems),
    tagEffects: condition.tagEffects,
  }))

const sortActions = (actions: CustomAction[]): CustomAction[] => [...actions].sort((a, b) => a.sortOrder - b.sortOrder)

const describeRequiredTags = (requiredTagIds: number[], tagsById: Map<number, TagDefinition>): string => {
  if (requiredTagIds.length === 0) return 'Always (no tags required)'
  return requiredTagIds.map((tagId) => tagsById.get(tagId)?.name ?? 'a deleted tag').join(' + ')
}

/** Checklist item list for one Condition — drag to reorder, tap to edit in place, delete with confirmation, mirroring the Checklist tab and Problems list elsewhere in the app. */
const ConditionChecklistItemsEditor = ({
  items,
  onChange,
}: {
  items: ChecklistItemDraft[]
  onChange: (items: ChecklistItemDraft[]) => void
}) => {
  const [draft, setDraft] = useState('')
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [touchTargetIndex, setTouchTargetIndex] = useState<number | null>(null)

  const addItem = () => {
    const text = draft.trim()
    if (!text) return
    onChange([...items, { id: createChecklistItemId(), text }])
    setDraft('')
  }

  const updateItemText = (id: string, text: string) => {
    onChange(items.map((item) => (item.id === id ? { ...item, text } : item)))
  }

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id))
    setPendingRemovalId(null)
  }

  const moveItem = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || !items[sourceIndex] || !items[targetIndex]) return
    const next = [...items]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onChange(next)
  }

  const resetDragState = () => {
    setDraggingIndex(null)
    setTouchTargetIndex(null)
  }

  const pendingRemoval = items.find((item) => item.id === pendingRemovalId) ?? null

  return (
    <div className='space-y-1.5'>
      <div className='flex flex-col gap-1'>
        {items.map((item, index) => (
          <div
            key={item.id}
            data-checklist-item-index={index}
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-clay/20 bg-warm-ivory px-1.5 py-1 transition-shadow',
              draggingIndex === index && 'opacity-50',
              touchTargetIndex === index && draggingIndex !== null && draggingIndex !== index && 'ring-2 ring-action-primary/40 ring-offset-1 ring-offset-transparent',
            )}
            onDragOver={(event: DragEvent<HTMLDivElement>) => {
              if (draggingIndex === null || draggingIndex === index) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              if (draggingIndex !== null) moveItem(draggingIndex, index)
              resetDragState()
            }}
          >
            <Button
              type='button'
              variant='ghost'
              className='h-6 w-6 shrink-0 p-0 text-clay cursor-grab active:cursor-grabbing touch-none'
              aria-label={`Reorder item ${index + 1}`}
              draggable
              onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                event.dataTransfer.effectAllowed = 'move'
                setDraggingIndex(index)
              }}
              onDragEnd={resetDragState}
              onTouchStart={(event: TouchEvent<HTMLButtonElement>) => {
                event.preventDefault()
                setDraggingIndex(index)
                setTouchTargetIndex(index)
              }}
              onTouchMove={(event: TouchEvent<HTMLButtonElement>) => {
                if (draggingIndex === null) return
                const touchPoint = event.touches[0]
                if (!touchPoint) return
                const target = document.elementFromPoint(touchPoint.clientX, touchPoint.clientY)?.closest('[data-checklist-item-index]')
                if (!(target instanceof HTMLElement)) return
                const targetIndex = Number.parseInt(target.dataset.checklistItemIndex ?? '', 10)
                if (!Number.isInteger(targetIndex)) return
                event.preventDefault()
                setTouchTargetIndex(targetIndex)
              }}
              onTouchEnd={() => {
                if (draggingIndex !== null && touchTargetIndex !== null) moveItem(draggingIndex, touchTargetIndex)
                resetDragState()
              }}
              onTouchCancel={resetDragState}
              onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                event.preventDefault()
                const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
                if (targetIndex >= 0 && targetIndex < items.length) moveItem(index, targetIndex)
              }}
            >
              <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
            </Button>
            <TapToEditField
              className='min-w-0 flex-1 px-1 py-0.5 text-xs'
              ariaLabel={`Checklist item ${index + 1}`}
              emptyText='Tap to edit'
              value={item.text}
              onCommit={(nextText) => updateItemText(item.id, nextText)}
              renderView={(text) => <span className='text-espresso'>{text}</span>}
              renderEditor={({ value, onChange: onEditorChange }) => (
                <AutoGrowTextField aria-label={`Checklist item ${index + 1}`} value={value} onChange={onEditorChange} className='text-xs' />
              )}
            />
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 w-6 shrink-0 p-0 text-action-danger'
              aria-label='Remove item'
              onClick={() => setPendingRemovalId(item.id)}
            >
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          </div>
        ))}
        {items.length === 0 ? <p className='text-[11px] text-clay/70'>No checklist items yet.</p> : null}
      </div>
      <div className='flex items-center gap-1.5'>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addItem()
            }
          }}
          placeholder='Add checklist item'
          aria-label='Add checklist item'
          className='h-8 text-xs'
        />
        <Button type='button' size='sm' variant='secondary' className='h-8' onClick={addItem}>Add</Button>
      </div>

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemovalId(null) }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Remove checklist item?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>Remove "{pendingRemoval?.text || 'this item'}" from this condition's checklist.</p>
          <div className='flex justify-end gap-2'>
            <Button variant='ghost' onClick={() => setPendingRemovalId(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => pendingRemoval && removeItem(pendingRemoval.id)}>Remove</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Every selectable tag, grouped and checkbox-toggled — a plain scrollable div rather than the
 * ScrollArea component, since nesting Radix ScrollAreas (this sits inside the dialog's own) ate
 * wheel/touch scroll input and left most tags unreachable.
 */
const RequiredTagsPicker = ({
  tags,
  groups,
  selectedTagIds,
  onToggle,
}: {
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  selectedTagIds: Set<number>
  onToggle: (tag: TagDefinition) => void
}) => (
  <div className='max-h-48 overflow-y-auto overscroll-contain rounded-lg border border-clay/15 bg-warm-ivory/60 p-1'>
    <BulkTagPicker tags={tags} groups={groups} selectedTagIds={selectedTagIds} onToggle={onToggle} />
  </div>
)

const TagEffectsEditor = ({
  tagEffects,
  tags,
  groups,
  onChange,
}: {
  tagEffects: CustomActionTagEffect[]
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onChange: (tagEffects: CustomActionTagEffect[]) => void
}) => {
  const tagsById = new Map(tags.filter((tag) => tag.id !== undefined).map((tag) => [tag.id as number, tag]))
  const tagBuckets = bucketTagsByGroup(tags, groups)

  const addTagEffect = () => {
    const firstTag = tags[0]
    if (!firstTag || firstTag.id === undefined) return
    onChange([...tagEffects, { tagId: firstTag.id, action: 'add' }])
  }

  const updateTagEffect = (effectIndex: number, next: Partial<CustomActionTagEffect>) => {
    onChange(tagEffects.map((effect, i) => (i === effectIndex ? { ...effect, ...next } : effect)))
  }

  const removeTagEffect = (effectIndex: number) => {
    onChange(tagEffects.filter((_, i) => i !== effectIndex))
  }

  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between'>
        <Label className='text-xs'>Tag effects</Label>
        <Button type='button' size='sm' variant='outline' className='h-6 text-[11px]' onClick={addTagEffect} disabled={tags.length === 0}>
          <Plus className='h-3 w-3 mr-1' /> Add effect
        </Button>
      </div>
      <div className='flex flex-col gap-1.5'>
        {tagEffects.map((effect, effectIndex) => (
          <div key={effectIndex} className='flex items-center gap-1.5'>
            <Select value={effect.action} onValueChange={(value) => updateTagEffect(effectIndex, { action: value as 'add' | 'remove' })}>
              <SelectTrigger className='h-8 w-28 text-xs'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='add'>Add tag</SelectItem>
                <SelectItem value='remove'>Remove tag</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(effect.tagId)} onValueChange={(value) => updateTagEffect(effectIndex, { tagId: Number.parseInt(value, 10) })}>
              <SelectTrigger className='h-8 flex-1 text-xs'><SelectValue /></SelectTrigger>
              <SelectContent>
                {tagBuckets.map((bucket) => (
                  bucket.tags.map((tag) => (
                    <SelectItem key={tag.id} value={String(tag.id)}>{bucket.groupName} — {tag.name}</SelectItem>
                  ))
                ))}
              </SelectContent>
            </Select>
            {tagsById.get(effect.tagId) ? <TagChip tag={tagsById.get(effect.tagId) as TagDefinition} /> : null}
            <Button type='button' variant='ghost' size='sm' className='h-8 w-8 p-0 text-action-danger' aria-label='Remove tag effect' onClick={() => removeTagEffect(effectIndex)}>
              <X className='h-3.5 w-3.5' />
            </Button>
          </div>
        ))}
        {tagEffects.length === 0 ? <p className='text-[11px] text-clay/70'>No tag effects configured.</p> : null}
      </div>
    </div>
  )
}

const ConditionCard = ({
  condition,
  index,
  tags,
  groups,
  onChange,
  onRequestRemove,
  dragHandleProps,
}: {
  condition: ConditionFormState
  index: number
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onChange: (next: ConditionFormState) => void
  onRequestRemove: () => void
  dragHandleProps: ReturnType<ReturnType<typeof useDragReorder<string>>['getHandleProps']>
}) => {
  const requiredTagIdSet = new Set(condition.requiredTagIds)

  const toggleRequiredTag = (tag: TagDefinition) => {
    if (tag.id === undefined) return
    const tagId = tag.id
    const next = requiredTagIdSet.has(tagId)
      ? condition.requiredTagIds.filter((id) => id !== tagId)
      : [...condition.requiredTagIds, tagId]
    onChange({ ...condition, requiredTagIds: next })
  }

  return (
    <div className='space-y-3 rounded-xl border border-clay/25 bg-blush-sand/20 p-3'>
      <div className='flex items-center gap-2'>
        <DragHandle label={`Drag to reorder condition ${index + 1}`} dragProps={dragHandleProps} />
        <p className='flex-1 text-xs font-bold uppercase tracking-widest text-clay/60'>Condition {index + 1}</p>
        <Button type='button' variant='ghost' size='sm' className='h-7 w-7 p-0 text-action-danger' aria-label={`Remove condition ${index + 1}`} onClick={onRequestRemove}>
          <Trash2 className='h-3.5 w-3.5' />
        </Button>
      </div>

      <div className='space-y-1'>
        <Label className='text-xs'>Required tags</Label>
        <p className='text-[11px] text-clay'>
          Matches a patient who has every tag selected below applied (in any tag group, including a specific Main/Referral Service).
        </p>
        <RequiredTagsPicker tags={tags} groups={groups} selectedTagIds={requiredTagIdSet} onToggle={toggleRequiredTag} />
      </div>

      <div className='space-y-1'>
        <Label className='text-xs'>Checklist items</Label>
        <ConditionChecklistItemsEditor
          items={condition.checklistItems}
          onChange={(items) => onChange({ ...condition, checklistItems: items })}
        />
      </div>

      <TagEffectsEditor
        tagEffects={condition.tagEffects}
        tags={tags}
        groups={groups}
        onChange={(tagEffects) => onChange({ ...condition, tagEffects })}
      />
    </div>
  )
}

export const ManageCustomActionsScreen = ({
  customActions,
  tags,
  groups,
  onBack,
}: {
  customActions: CustomAction[]
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  onBack: () => void
}) => {
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<CustomActionFormState>(blankCustomActionForm())
  const [editingActionId, setEditingActionId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomAction | null>(null)
  const [pendingConditionRemovalId, setPendingConditionRemovalId] = useState<string | null>(null)

  const orderedActions = sortActions(customActions)
  const tagsById = new Map(tags.filter((tag) => tag.id !== undefined).map((tag) => [tag.id as number, tag]))
  const tagBuckets = bucketTagsByGroup(tags, groups)

  const openCreate = () => {
    setEditingActionId(null)
    setForm(blankCustomActionForm())
    setFormOpen(true)
  }

  const openEdit = (action: CustomAction) => {
    setEditingActionId(action.id ?? null)
    setForm(actionToForm(action))
    setFormOpen(true)
  }

  const updateCondition = (conditionId: string, next: ConditionFormState) => {
    setForm((previous) => ({
      ...previous,
      conditions: previous.conditions.map((condition) => (condition.id === conditionId ? next : condition)),
    }))
  }

  const addCondition = () => {
    setForm((previous) => ({ ...previous, conditions: [...previous.conditions, blankCondition()] }))
  }

  const removeCondition = (conditionId: string) => {
    setForm((previous) => ({ ...previous, conditions: previous.conditions.filter((condition) => condition.id !== conditionId) }))
    setPendingConditionRemovalId(null)
  }

  const reorderConditions = (sourceId: string, targetId: string) => {
    setForm((previous) => ({ ...previous, conditions: moveItemByKey(previous.conditions, (condition) => condition.id, sourceId, targetId) }))
  }
  const conditionDrag = useDragReorder(form.conditions.map((condition) => condition.id), reorderConditions)

  const saveForm = async () => {
    const name = form.name.trim()
    if (!name) return
    const triggerTagId = form.triggerTagId ? Number.parseInt(form.triggerTagId, 10) : undefined
    if (form.triggerType === 'automatic' && triggerTagId === undefined) return
    const checklistItems = formChecklistItemsToStrings(form.checklistItems)
    const conditions = formToConditions(form.conditions)

    if (editingActionId !== null) {
      await db.customActions.update(editingActionId, {
        name,
        triggerType: form.triggerType,
        triggerTagId: form.triggerType === 'automatic' ? triggerTagId : undefined,
        checklistItems,
        tagEffects: form.tagEffects,
        conditions,
      })
    } else {
      const nextSortOrder = customActions.length > 0 ? Math.max(...customActions.map((action) => action.sortOrder)) + 1 : 0
      await db.customActions.add({
        name,
        triggerType: form.triggerType,
        triggerTagId: form.triggerType === 'automatic' ? triggerTagId : undefined,
        checklistItems,
        tagEffects: form.tagEffects,
        conditions,
        sortOrder: nextSortOrder,
        createdAt: new Date().toISOString(),
      })
    }

    setFormOpen(false)
  }

  const confirmDelete = async () => {
    if (deleteTarget?.id === undefined) return
    await db.transaction('rw', [db.customActions, db.customActionRuns], async () => {
      await db.customActionRuns.where('actionId').equals(deleteTarget.id as number).delete()
      await db.customActions.delete(deleteTarget.id as number)
    })
    setDeleteTarget(null)
  }

  const reorderActions = async (sourceId: number, targetId: number) => {
    const reordered = moveItemByKey(orderedActions, (action) => action.id, sourceId, targetId)
    await db.transaction('rw', [db.customActions], async () => {
      await Promise.all(
        reordered.map((action, index) =>
          action.id === undefined || action.sortOrder === index ? Promise.resolve() : db.customActions.update(action.id, { sortOrder: index }),
        ),
      )
    })
  }
  const actionDrag = useDragReorder(orderedActions.map((action) => action.id as number), (source, target) => void reorderActions(source, target))

  const triggerTagName = (action: CustomAction): string => {
    if (action.triggerTagId === undefined) return 'no tag configured'
    return tagsById.get(action.triggerTagId)?.name ?? 'a deleted tag'
  }

  const pendingConditionRemoval = form.conditions.find((condition) => condition.id === pendingConditionRemovalId) ?? null

  return (
    <Card className='bg-white/80 border-clay/25 shadow-sm'>
      <CardHeader className='py-3 px-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' className='h-7 w-7 p-0' onClick={onBack} aria-label='Back to Settings'>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <CardTitle className='text-base text-espresso'>Manage Custom Actions</CardTitle>
        </div>
      </CardHeader>
      <CardContent className='px-4 pb-4 space-y-4'>
        <div className='flex items-center justify-between'>
          <p className='text-xs text-clay max-w-[70%]'>
            Custom Actions append checklist items and/or add or remove tags, either manually via a button or automatically when a tag is added.
          </p>
          <Button size='sm' variant='outline' onClick={openCreate}>
            <Plus className='h-3.5 w-3.5 mr-1' /> Add action
          </Button>
        </div>

        <div className='flex flex-col gap-1.5'>
          {orderedActions.map((action) => (
            <div
              key={action.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-clay/20 bg-warm-ivory px-2.5 py-2 transition-shadow',
                actionDrag.isDragging(action.id as number) && 'opacity-50',
                actionDrag.isDropTarget(action.id as number) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
              )}
              {...actionDrag.getItemProps(action.id as number)}
            >
              <DragHandle label={`Drag to reorder ${action.name}`} dragProps={actionDrag.getHandleProps(action.id as number)} />
              <div className='flex-1 min-w-0'>
                <p className='text-sm font-semibold text-espresso truncate'>{action.name}</p>
                <p className='text-[11px] text-clay/80'>
                  {action.triggerType === 'manual' ? 'Manual button' : `Automatic on "${triggerTagName(action)}" added`}
                  {action.conditions.length > 0
                    ? ` · ${action.conditions.length} condition${action.conditions.length === 1 ? '' : 's'}`
                    : ' · applies uniformly (no conditions)'}
                </p>
              </div>
              <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' aria-label={`Edit ${action.name}`} onClick={() => openEdit(action)}>
                <Pencil className='h-3.5 w-3.5' />
              </Button>
              <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-action-danger' aria-label={`Delete ${action.name}`} onClick={() => setDeleteTarget(action)}>
                <Trash2 className='h-3.5 w-3.5' />
              </Button>
            </div>
          ))}
          {orderedActions.length === 0 ? <p className='text-xs text-clay'>No Custom Actions defined yet.</p> : null}
        </div>
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{editingActionId !== null ? 'Edit Custom Action' : 'New Custom Action'}</DialogTitle>
          </DialogHeader>
          <ScrollArea className='max-h-[70vh] pr-3'>
            <div className='space-y-4'>
              <div className='space-y-1'>
                <Label htmlFor='custom-action-name'>Name</Label>
                <Input
                  id='custom-action-name'
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder='e.g. Start Admission Papers'
                />
              </div>

              <div className='space-y-1'>
                <Label>Trigger</Label>
                <div className='flex gap-3 text-sm'>
                  <label className='flex items-center gap-1.5'>
                    <input
                      type='radio'
                      name='customActionTrigger'
                      checked={form.triggerType === 'manual'}
                      onChange={() => setForm({ ...form, triggerType: 'manual' })}
                    />
                    Manual (button press)
                  </label>
                  <label className='flex items-center gap-1.5'>
                    <input
                      type='radio'
                      name='customActionTrigger'
                      checked={form.triggerType === 'automatic'}
                      onChange={() => setForm({ ...form, triggerType: 'automatic' })}
                    />
                    Automatic (on tag added)
                  </label>
                </div>
              </div>

              {form.triggerType === 'automatic' ? (
                <div className='space-y-1'>
                  <Label>Trigger tag</Label>
                  <Select value={form.triggerTagId} onValueChange={(value) => setForm({ ...form, triggerTagId: value })}>
                    <SelectTrigger><SelectValue placeholder='Choose a tag…' /></SelectTrigger>
                    <SelectContent>
                      {tagBuckets.map((bucket) => (
                        bucket.tags.map((tag) => (
                          <SelectItem key={tag.id} value={String(tag.id)}>{bucket.groupName} — {tag.name}</SelectItem>
                        ))
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-xs text-clay'>Fires the instant this tag transitions from absent to present on a patient.</p>
                </div>
              ) : null}

              <div className='space-y-2 rounded-xl border border-clay/25 bg-warm-ivory/50 p-3'>
                <div>
                  <Label>Applies to every patient</Label>
                  <p className='text-xs text-clay'>
                    Runs unconditionally whenever this action is triggered — no condition needs to be defined below for this to run.
                  </p>
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>Checklist items</Label>
                  <ConditionChecklistItemsEditor
                    items={form.checklistItems}
                    onChange={(items) => setForm({ ...form, checklistItems: items })}
                  />
                </div>
                <TagEffectsEditor
                  tagEffects={form.tagEffects}
                  tags={tags}
                  groups={groups}
                  onChange={(tagEffects) => setForm({ ...form, tagEffects })}
                />
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label>Conditions (optional)</Label>
                  <Button type='button' size='sm' variant='outline' onClick={addCondition}>
                    <Plus className='h-3.5 w-3.5 mr-1' /> Add condition
                  </Button>
                </div>
                <p className='text-xs text-clay'>
                  Adds extra checklist items and tag effects on top of the unconditional ones above, scoped to patients with a specific
                  combination of tags applied. Each condition matches independently — several can apply to the same patient at once. A
                  patient this action does nothing for (no unconditional items/effects and no condition met) is left unaffected and
                  flagged rather than guessed at.
                </p>
                <div className='space-y-3'>
                  {form.conditions.map((condition, index) => (
                    <div
                      key={condition.id}
                      className={cn(
                        conditionDrag.isDragging(condition.id) && 'opacity-50',
                        conditionDrag.isDropTarget(condition.id) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent rounded-xl',
                      )}
                      {...conditionDrag.getItemProps(condition.id)}
                    >
                      <ConditionCard
                        condition={condition}
                        index={index}
                        tags={tags}
                        groups={groups}
                        onChange={(next) => updateCondition(condition.id, next)}
                        onRequestRemove={() => setPendingConditionRemovalId(condition.id)}
                        dragHandleProps={conditionDrag.getHandleProps(condition.id)}
                      />
                    </div>
                  ))}
                  {form.conditions.length === 0 ? <p className='text-xs text-clay'>No conditions defined — this action only runs the unconditional items/effects above for every patient.</p> : null}
                </div>
              </div>
            </div>
          </ScrollArea>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='ghost' onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void saveForm()}
              disabled={!form.name.trim() || (form.triggerType === 'automatic' && !form.triggerTagId)}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingConditionRemoval !== null} onOpenChange={(open) => { if (!open) setPendingConditionRemovalId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this condition?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>
            {pendingConditionRemoval ? `This removes the "${describeRequiredTags(pendingConditionRemoval.requiredTagIds, tagsById)}" condition, its checklist items, and its tag effects.` : ''}
          </p>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='ghost' onClick={() => setPendingConditionRemovalId(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => pendingConditionRemoval && removeCondition(pendingConditionRemoval.id)}>Remove</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>This does not remove any checklist items or tags it already applied.</p>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='ghost' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => void confirmDelete()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
