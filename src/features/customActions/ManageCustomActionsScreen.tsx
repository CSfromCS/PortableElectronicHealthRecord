import { useState } from 'react'
import { ChevronLeft, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import type {
  CustomAction,
  CustomActionTagEffect,
  CustomActionTriggerType,
  CustomActionVariantKey,
  CustomActionVariants,
  TagDefinition,
  TagGroupDefinition,
} from '@/types'
import { CUSTOM_ACTION_VARIANT_KEYS, CUSTOM_ACTION_VARIANT_LABELS, emptyCustomActionVariants } from './customActionConstants'
import { bucketTagsByGroup } from '@/features/tags/tagUtils'
import { TagChip } from '@/features/tags/TagChip'

type CustomActionFormState = {
  name: string
  triggerType: CustomActionTriggerType
  triggerTagId: string
  variants: CustomActionVariants
  tagEffects: CustomActionTagEffect[]
}

const blankCustomActionForm = (): CustomActionFormState => ({
  name: '',
  triggerType: 'manual',
  triggerTagId: '',
  variants: emptyCustomActionVariants(),
  tagEffects: [],
})

const actionToForm = (action: CustomAction): CustomActionFormState => ({
  name: action.name,
  triggerType: action.triggerType,
  triggerTagId: action.triggerTagId !== undefined ? String(action.triggerTagId) : '',
  variants: {
    'cd-main': [...action.variants['cd-main']],
    'cd-referral': [...action.variants['cd-referral']],
    'pd-main': [...action.variants['pd-main']],
    'pd-referral': [...action.variants['pd-referral']],
  },
  tagEffects: action.tagEffects.map((effect) => ({ ...effect })),
})

const sortActions = (actions: CustomAction[]): CustomAction[] => [...actions].sort((a, b) => a.sortOrder - b.sortOrder)

const VariantItemsEditor = ({
  variantKey,
  items,
  onChange,
}: {
  variantKey: CustomActionVariantKey
  items: string[]
  onChange: (items: string[]) => void
}) => {
  const [draft, setDraft] = useState('')

  const addItem = () => {
    const text = draft.trim()
    if (!text) return
    onChange([...items, text])
    setDraft('')
  }

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className='space-y-1.5'>
      <p className='text-xs font-semibold text-espresso'>{CUSTOM_ACTION_VARIANT_LABELS[variantKey]}</p>
      <div className='flex flex-col gap-1'>
        {items.map((text, index) => (
          <div key={index} className='flex items-center gap-1.5 rounded-md border border-clay/20 bg-warm-ivory px-2 py-1'>
            <span className='flex-1 min-w-0 text-xs text-espresso truncate'>{text}</span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 w-6 p-0 text-clay'
              aria-label='Move item up'
              disabled={index === 0}
              onClick={() => moveItem(index, 'up')}
            >
              ↑
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 w-6 p-0 text-clay'
              aria-label='Move item down'
              disabled={index === items.length - 1}
              onClick={() => moveItem(index, 'down')}
            >
              ↓
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 w-6 p-0 text-action-danger'
              aria-label='Remove item'
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
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
          aria-label={`Add checklist item to ${CUSTOM_ACTION_VARIANT_LABELS[variantKey]}`}
          className='h-8 text-xs'
        />
        <Button type='button' size='sm' variant='secondary' className='h-8' onClick={addItem}>Add</Button>
      </div>
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

  const orderedActions = sortActions(customActions)
  const tagBuckets = bucketTagsByGroup(tags, groups)
  const tagsById = new Map(tags.filter((tag) => tag.id !== undefined).map((tag) => [tag.id as number, tag]))

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

  const setVariantItems = (variantKey: CustomActionVariantKey, items: string[]) => {
    setForm((previous) => ({ ...previous, variants: { ...previous.variants, [variantKey]: items } }))
  }

  const addTagEffect = () => {
    const firstTag = tags[0]
    if (!firstTag || firstTag.id === undefined) return
    setForm((previous) => ({ ...previous, tagEffects: [...previous.tagEffects, { tagId: firstTag.id as number, action: 'add' }] }))
  }

  const updateTagEffect = (index: number, next: Partial<CustomActionTagEffect>) => {
    setForm((previous) => ({
      ...previous,
      tagEffects: previous.tagEffects.map((effect, effectIndex) => (effectIndex === index ? { ...effect, ...next } : effect)),
    }))
  }

  const removeTagEffect = (index: number) => {
    setForm((previous) => ({ ...previous, tagEffects: previous.tagEffects.filter((_, effectIndex) => effectIndex !== index) }))
  }

  const saveForm = async () => {
    const name = form.name.trim()
    if (!name) return
    const triggerTagId = form.triggerTagId ? Number.parseInt(form.triggerTagId, 10) : undefined
    if (form.triggerType === 'automatic' && triggerTagId === undefined) return

    if (editingActionId !== null) {
      await db.customActions.update(editingActionId, {
        name,
        triggerType: form.triggerType,
        triggerTagId: form.triggerType === 'automatic' ? triggerTagId : undefined,
        variants: form.variants,
        tagEffects: form.tagEffects,
      })
    } else {
      const nextSortOrder = customActions.length > 0 ? Math.max(...customActions.map((action) => action.sortOrder)) + 1 : 0
      await db.customActions.add({
        name,
        triggerType: form.triggerType,
        triggerTagId: form.triggerType === 'automatic' ? triggerTagId : undefined,
        variants: form.variants,
        tagEffects: form.tagEffects,
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
                  {action.tagEffects.length > 0 ? ` · ${action.tagEffects.length} tag effect${action.tagEffects.length === 1 ? '' : 's'}` : ''}
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

              <div className='space-y-2'>
                <Label>Task List Variants</Label>
                <p className='text-xs text-clay'>
                  Each combination of Category and Relationship gets its own checklist. When triggered, only the variant matching the
                  patient's current tags is appended.
                </p>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                  {CUSTOM_ACTION_VARIANT_KEYS.map((variantKey) => (
                    <VariantItemsEditor
                      key={variantKey}
                      variantKey={variantKey}
                      items={form.variants[variantKey]}
                      onChange={(items) => setVariantItems(variantKey, items)}
                    />
                  ))}
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label>Tag Effects</Label>
                  <Button type='button' size='sm' variant='outline' className='h-7 text-xs' onClick={addTagEffect} disabled={tags.length === 0}>
                    <Plus className='h-3.5 w-3.5 mr-1' /> Add effect
                  </Button>
                </div>
                <p className='text-xs text-clay'>Applied every time this action runs, independently of whether the checklist portion succeeded.</p>
                <div className='flex flex-col gap-1.5'>
                  {form.tagEffects.map((effect, index) => (
                    <div key={index} className='flex items-center gap-1.5'>
                      <Select value={effect.action} onValueChange={(value) => updateTagEffect(index, { action: value as 'add' | 'remove' })}>
                        <SelectTrigger className='h-8 w-28 text-xs'><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value='add'>Add tag</SelectItem>
                          <SelectItem value='remove'>Remove tag</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={String(effect.tagId)} onValueChange={(value) => updateTagEffect(index, { tagId: Number.parseInt(value, 10) })}>
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
                      <Button type='button' variant='ghost' size='sm' className='h-8 w-8 p-0 text-action-danger' aria-label='Remove tag effect' onClick={() => removeTagEffect(index)}>
                        <X className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  ))}
                  {form.tagEffects.length === 0 ? <p className='text-[11px] text-clay/70'>No tag effects configured.</p> : null}
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
