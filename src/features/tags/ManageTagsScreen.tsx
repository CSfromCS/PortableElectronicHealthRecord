import { useRef, useState } from 'react'
import { ChevronLeft, Pencil, Trash2, Plus } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder } from '@/lib/dnd/useDragReorder'
import type { Patient, TagAutomationRole, TagDefinition, TagDisplayType, TagGroupDefinition } from '@/types'
import { AUTOMATION_ROLE_LABELS, UNGROUPED_LABEL } from './tagConstants'
import { bucketTagsByGroup, sortTagGroups, sortTagsInGroup } from './tagUtils'
import { TagChip } from './TagChip'

type TagFormState = {
  name: string
  displayType: TagDisplayType
  emoji: string
  color: string
  displayText: string
  groupId: string
  visibleOnPatientCard: boolean
  terminal: boolean
  automationRole: TagAutomationRole
}

const blankTagForm = (defaultGroupId?: string): TagFormState => ({
  name: '',
  displayType: 'emoji',
  emoji: '',
  color: '#c98a5e',
  displayText: '',
  groupId: defaultGroupId ?? '',
  visibleOnPatientCard: true,
  terminal: false,
  automationRole: 'none',
})

const tagToForm = (tag: TagDefinition): TagFormState => ({
  name: tag.name,
  displayType: tag.displayType,
  emoji: tag.emoji ?? '',
  color: tag.color ?? '#c98a5e',
  displayText: tag.displayText ?? '',
  groupId: tag.groupId !== undefined ? String(tag.groupId) : '',
  visibleOnPatientCard: tag.visibleOnPatientCard,
  terminal: tag.terminal,
  automationRole: tag.automationRole,
})

const sanitizeHexInput = (raw: string): string => `#${raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)}`

export const ManageTagsScreen = ({
  tags,
  groups,
  patients,
  onBack,
}: {
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  patients: Patient[]
  onBack: () => void
}) => {
  const [tagFormOpen, setTagFormOpen] = useState(false)
  const [tagForm, setTagForm] = useState<TagFormState>(blankTagForm())
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<number | null>(null)
  const [renamingGroupName, setRenamingGroupName] = useState('')
  const [deleteTagTarget, setDeleteTagTarget] = useState<TagDefinition | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<TagGroupDefinition | null>(null)

  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set())
  const [bulkColor, setBulkColor] = useState('#c98a5e')
  const [bulkGroupSelection, setBulkGroupSelection] = useState('')
  const [bulkNewGroupName, setBulkNewGroupName] = useState('')

  const orderedGroups = sortTagGroups(groups)
  const buckets = bucketTagsByGroup(tags, groups)
  const bucketsById = new Map(buckets.map((bucket) => [bucket.groupId, bucket]))

  const patientHasTag = (patient: Patient, tagId: number) =>
    (patient.tagIds ?? []).includes(tagId)
    || (patient.mainServiceTagIds ?? []).includes(tagId)
    || (patient.referralServiceTagIds ?? []).includes(tagId)

  const patientCountForTag = (tagId: number | undefined) =>
    tagId === undefined ? 0 : patients.filter((patient) => patientHasTag(patient, tagId)).length

  const openCreateTag = (groupId?: number) => {
    setEditingTagId(null)
    setTagForm(blankTagForm(groupId !== undefined ? String(groupId) : ''))
    setTagFormOpen(true)
  }

  const openEditTag = (tag: TagDefinition) => {
    setEditingTagId(tag.id ?? null)
    setTagForm(tagToForm(tag))
    setTagFormOpen(true)
  }

  const saveTagForm = async () => {
    const name = tagForm.name.trim()
    if (!name) return

    const groupId = tagForm.groupId ? Number.parseInt(tagForm.groupId, 10) : undefined
    const now = new Date().toISOString()

    if (editingTagId !== null) {
      await db.tagDefinitions.update(editingTagId, {
        name,
        displayType: tagForm.displayType,
        emoji: tagForm.displayType === 'emoji' ? (tagForm.emoji.trim() || undefined) : undefined,
        color: tagForm.displayType === 'color' ? tagForm.color : undefined,
        displayText: tagForm.displayType === 'color' ? (tagForm.displayText.trim() || undefined) : undefined,
        groupId,
        visibleOnPatientCard: tagForm.visibleOnPatientCard,
        terminal: tagForm.terminal,
        automationRole: tagForm.automationRole,
      })
    } else {
      const siblingTags = tags.filter((tag) => (tag.groupId ?? undefined) === groupId)
      const nextSortOrder = siblingTags.length > 0 ? Math.max(...siblingTags.map((tag) => tag.sortOrder)) + 1 : 0
      await db.tagDefinitions.add({
        name,
        displayType: tagForm.displayType,
        emoji: tagForm.displayType === 'emoji' ? (tagForm.emoji.trim() || undefined) : undefined,
        color: tagForm.displayType === 'color' ? tagForm.color : undefined,
        displayText: tagForm.displayType === 'color' ? (tagForm.displayText.trim() || undefined) : undefined,
        groupId,
        sortOrder: nextSortOrder,
        visibleOnPatientCard: tagForm.visibleOnPatientCard,
        terminal: tagForm.terminal,
        automationRole: tagForm.automationRole,
        createdAt: now,
      })
    }

    setTagFormOpen(false)
  }

  const confirmDeleteTag = async () => {
    if (deleteTagTarget?.id === undefined) return
    const tagId = deleteTagTarget.id

    await db.transaction('rw', [db.patients, db.tagDefinitions], async () => {
      const affectedPatients = await db.patients.filter((patient) => patientHasTag(patient, tagId)).toArray()
      await Promise.all(
        affectedPatients.map((patient) =>
          patient.id === undefined
            ? Promise.resolve()
            : db.patients.update(patient.id, {
                tagIds: (patient.tagIds ?? []).filter((id) => id !== tagId),
                mainServiceTagIds: (patient.mainServiceTagIds ?? []).filter((id) => id !== tagId),
                referralServiceTagIds: (patient.referralServiceTagIds ?? []).filter((id) => id !== tagId),
              }),
        ),
      )
      await db.tagDefinitions.delete(tagId)
    })

    setDeleteTagTarget(null)
  }

  const addGroup = async () => {
    const name = newGroupName.trim()
    if (!name) return
    const nextSortOrder = groups.length > 0 ? Math.max(...groups.map((group) => group.sortOrder)) + 1 : 0
    await db.tagGroups.add({ name, sortOrder: nextSortOrder })
    setNewGroupName('')
  }

  const startRenameGroup = (group: TagGroupDefinition) => {
    setRenamingGroupId(group.id ?? null)
    setRenamingGroupName(group.name)
  }

  const saveRenameGroup = async () => {
    if (renamingGroupId === null) return
    const name = renamingGroupName.trim()
    if (name) {
      await db.tagGroups.update(renamingGroupId, { name })
    }
    setRenamingGroupId(null)
  }

  const confirmDeleteGroup = async () => {
    if (deleteGroupTarget?.id === undefined) return
    const groupId = deleteGroupTarget.id
    const tagsInGroup = tags.filter((tag) => tag.groupId === groupId)

    await db.transaction('rw', [db.tagDefinitions, db.tagGroups], async () => {
      await Promise.all(
        tagsInGroup.map((tag) => (tag.id === undefined ? Promise.resolve() : db.tagDefinitions.update(tag.id, { groupId: undefined }))),
      )
      await db.tagGroups.delete(groupId)
    })

    setDeleteGroupTarget(null)
  }

  const reorderGroups = async (sourceGroupId: number, targetGroupId: number) => {
    const reordered = moveItemByKey(orderedGroups, (group) => group.id, sourceGroupId, targetGroupId)
    await db.transaction('rw', [db.tagGroups], async () => {
      await Promise.all(
        reordered.map((group, index) =>
          group.id === undefined || group.sortOrder === index ? Promise.resolve() : db.tagGroups.update(group.id, { sortOrder: index }),
        ),
      )
    })
  }
  const groupDrag = useDragReorder(orderedGroups.map((group) => group.id as number), (source, target) => void reorderGroups(source, target))

  const reorderTags = async (sourceTagId: number, targetTagId: number) => {
    const sourceTag = tags.find((tag) => tag.id === sourceTagId)
    const targetTag = tags.find((tag) => tag.id === targetTagId)
    if (!sourceTag || !targetTag || (sourceTag.groupId ?? null) !== (targetTag.groupId ?? null)) return

    const bucket = bucketsById.get(sourceTag.groupId ?? null)
    const siblings = bucket ? sortTagsInGroup(bucket.tags) : []
    const reordered = moveItemByKey(siblings, (tag) => tag.id, sourceTagId, targetTagId)
    await db.transaction('rw', [db.tagDefinitions], async () => {
      await Promise.all(
        reordered.map((tag, index) =>
          tag.id === undefined || tag.sortOrder === index ? Promise.resolve() : db.tagDefinitions.update(tag.id, { sortOrder: index }),
        ),
      )
    })
  }
  const tagDrag = useDragReorder(tags.map((tag) => tag.id as number), (source, target) => void reorderTags(source, target))

  // Multi-select is independent of which Tag Group a tag currently sits in, so bulk actions
  // (recolor, card visibility, terminal flag, move-to-group) can span tags from any category.
  const selectedTags = tags.filter((tag) => tag.id !== undefined && selectedTagIds.has(tag.id))
  const toggleTagSelected = (tagId: number | undefined) => {
    if (tagId === undefined) return
    setSelectedTagIds((previous) => {
      const next = new Set(previous)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }
  const clearSelection = () => {
    setSelectedTagIds(new Set())
    setSelectionMode(false)
  }

  // On desktop, the checkbox is always there to click. On touch devices it stays hidden — to cut
  // clutter — until a long-press on a tag's content enters selection mode; a plain tap while
  // already in selection mode then toggles that tag instead of long-pressing again.
  const [selectionMode, setSelectionMode] = useState(false)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleTagContentTouchStart = (tagId: number | undefined) => {
    if (tagId === undefined) return
    longPressFiredRef.current = false
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      setSelectionMode(true)
      toggleTagSelected(tagId)
    }, 500)
  }

  const handleTagContentTouchEnd = (tagId: number | undefined) => {
    cancelLongPress()
    if (!longPressFiredRef.current && selectionMode) {
      toggleTagSelected(tagId)
    }
    longPressFiredRef.current = false
  }

  const applyBulkColor = async () => {
    const targets = selectedTags.filter((tag) => tag.displayType === 'color' && tag.id !== undefined)
    if (targets.length === 0) return
    await db.transaction('rw', [db.tagDefinitions], async () => {
      await Promise.all(targets.map((tag) => db.tagDefinitions.update(tag.id as number, { color: bulkColor })))
    })
  }

  const setBulkVisibility = async (visibleOnPatientCard: boolean) => {
    const ids = [...selectedTagIds]
    if (ids.length === 0) return
    await db.transaction('rw', [db.tagDefinitions], async () => {
      await Promise.all(ids.map((id) => db.tagDefinitions.update(id, { visibleOnPatientCard })))
    })
  }

  const setBulkTerminal = async (terminal: boolean) => {
    const ids = [...selectedTagIds]
    if (ids.length === 0) return
    await db.transaction('rw', [db.tagDefinitions], async () => {
      await Promise.all(ids.map((id) => db.tagDefinitions.update(id, { terminal })))
    })
  }

  const applyBulkGroup = async () => {
    const ids = [...selectedTagIds]
    if (ids.length === 0 || !bulkGroupSelection) return

    let targetGroupId: number | undefined
    if (bulkGroupSelection === '__new__') {
      const name = bulkNewGroupName.trim()
      if (!name) return
      const nextSortOrder = groups.length > 0 ? Math.max(...groups.map((group) => group.sortOrder)) + 1 : 0
      targetGroupId = await db.tagGroups.add({ name, sortOrder: nextSortOrder })
    } else if (bulkGroupSelection === '__ungrouped__') {
      targetGroupId = undefined
    } else {
      targetGroupId = Number.parseInt(bulkGroupSelection, 10)
    }

    await db.transaction('rw', [db.tagDefinitions], async () => {
      await Promise.all(ids.map((id) => db.tagDefinitions.update(id, { groupId: targetGroupId })))
    })
    setBulkGroupSelection('')
    setBulkNewGroupName('')
  }

  return (
    <Card className='bg-white/80 border-clay/25 shadow-sm'>
      <CardHeader className='py-3 px-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' className='h-7 w-7 p-0' onClick={onBack} aria-label='Back to Settings'>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <CardTitle className='text-base text-espresso'>Manage Tags</CardTitle>
        </div>
      </CardHeader>
      <CardContent className='px-4 pb-4 space-y-5'>
        <div className='space-y-2'>
          <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Tag Groups</p>
          <div className='flex flex-col gap-1.5'>
            {orderedGroups.map((group) => (
              <div
                key={group.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-clay/20 bg-warm-ivory px-2.5 py-1.5 transition-shadow',
                  groupDrag.isDragging(group.id as number) && 'opacity-50',
                  groupDrag.isDropTarget(group.id as number) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
                )}
                {...groupDrag.getItemProps(group.id as number)}
              >
                <DragHandle label={`Drag to reorder ${group.name} group`} dragProps={groupDrag.getHandleProps(group.id as number)} />
                {renamingGroupId === group.id ? (
                  <div className='flex-1 flex items-center gap-1.5'>
                    <Input value={renamingGroupName} onChange={(event) => setRenamingGroupName(event.target.value)} className='h-7 text-sm' autoFocus />
                    <Button size='sm' className='h-7' onClick={() => void saveRenameGroup()}>Save</Button>
                  </div>
                ) : (
                  <span className='flex-1 text-sm text-espresso font-medium'>{group.name}</span>
                )}
                <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' aria-label={`Rename ${group.name}`} onClick={() => startRenameGroup(group)}>
                  <Pencil className='h-3.5 w-3.5' />
                </Button>
                <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-action-danger' aria-label={`Delete ${group.name}`} onClick={() => setDeleteGroupTarget(group)}>
                  <Trash2 className='h-3.5 w-3.5' />
                </Button>
              </div>
            ))}
          </div>
          <div className='flex items-center gap-1.5'>
            <Input placeholder='New group name' value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} className='h-8 text-sm' />
            <Button size='sm' className='h-8' onClick={() => void addGroup()}>Add</Button>
          </div>
        </div>

        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Tags</p>
            <Button size='sm' variant='outline' onClick={() => openCreateTag()}>
              <Plus className='h-3.5 w-3.5 mr-1' /> Add tag
            </Button>
          </div>

          {selectedTagIds.size > 0 ? (
            <div className='rounded-lg border border-action-primary/40 bg-action-primary/5 p-3 space-y-2.5'>
              <div className='flex items-center justify-between'>
                <p className='text-xs font-semibold text-espresso'>
                  {selectedTagIds.size} tag{selectedTagIds.size === 1 ? '' : 's'} selected
                </p>
                <Button variant='ghost' size='sm' className='h-6 text-xs px-2' onClick={clearSelection}>Clear</Button>
              </div>

              <div className='flex flex-wrap items-center gap-1.5'>
                <span className='text-xs text-clay w-24 shrink-0'>Badge color</span>
                <input
                  type='color'
                  value={/^#[0-9a-fA-F]{6}$/.test(bulkColor) ? bulkColor : '#c98a5e'}
                  onChange={(event) => setBulkColor(event.target.value)}
                  className='h-7 w-9 shrink-0 rounded border border-clay/30 p-0.5'
                />
                <Input
                  value={bulkColor}
                  onChange={(event) => setBulkColor(sanitizeHexInput(event.target.value))}
                  className='w-24 h-7 font-mono text-xs'
                  maxLength={7}
                  aria-label='Bulk badge color hex code'
                />
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 text-xs'
                  disabled={!selectedTags.some((tag) => tag.displayType === 'color')}
                  onClick={() => void applyBulkColor()}
                >
                  Apply
                </Button>
                <span className='text-[10px] text-clay/70'>Only affects selected "Text with Color" tags</span>
              </div>

              <div className='flex flex-wrap items-center gap-1.5'>
                <span className='text-xs text-clay w-24 shrink-0'>Card visibility</span>
                <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => void setBulkVisibility(true)}>Show on card</Button>
                <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => void setBulkVisibility(false)}>Hide on card</Button>
              </div>

              <div className='flex flex-wrap items-center gap-1.5'>
                <span className='text-xs text-clay w-24 shrink-0'>Terminal</span>
                <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => void setBulkTerminal(true)}>Mark terminal</Button>
                <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => void setBulkTerminal(false)}>Clear terminal</Button>
              </div>

              <div className='flex flex-wrap items-center gap-1.5'>
                <span className='text-xs text-clay w-24 shrink-0'>Tag group</span>
                <Select value={bulkGroupSelection} onValueChange={setBulkGroupSelection}>
                  <SelectTrigger className='h-7 w-40 text-xs'><SelectValue placeholder='Move to…' /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__ungrouped__'>{UNGROUPED_LABEL}</SelectItem>
                    {sortTagGroups(groups).map((group) => (
                      <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                    ))}
                    <SelectItem value='__new__'>+ New group…</SelectItem>
                  </SelectContent>
                </Select>
                {bulkGroupSelection === '__new__' ? (
                  <Input
                    placeholder='New group name'
                    value={bulkNewGroupName}
                    onChange={(event) => setBulkNewGroupName(event.target.value)}
                    className='h-7 w-36 text-xs'
                  />
                ) : null}
                <Button
                  size='sm'
                  className='h-7 text-xs'
                  disabled={!bulkGroupSelection || (bulkGroupSelection === '__new__' && !bulkNewGroupName.trim())}
                  onClick={() => void applyBulkGroup()}
                >
                  Apply
                </Button>
                <span className='text-[10px] text-clay/70'>Moves tags here regardless of their current group</span>
              </div>
            </div>
          ) : null}

          {buckets.length === 0 ? <p className='text-xs text-clay'>No tags defined yet.</p> : null}
          {buckets.map((bucket) => (
            <div key={bucket.groupId ?? 'ungrouped'} className='space-y-1.5'>
              <p className='text-xs font-semibold text-espresso'>{bucket.groupName === UNGROUPED_LABEL ? UNGROUPED_LABEL : bucket.groupName}</p>
              <div className='flex flex-col gap-1'>
                {bucket.tags.map((tag) => (
                  <div
                    key={tag.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-clay/20 bg-warm-ivory px-2.5 py-1.5 transition-shadow',
                      tagDrag.isDragging(tag.id as number) && 'opacity-50',
                      tagDrag.isDropTarget(tag.id as number) && 'ring-2 ring-action-primary/50 ring-offset-1 ring-offset-transparent',
                    )}
                    {...tagDrag.getItemProps(tag.id as number)}
                  >
                    <input
                      type='checkbox'
                      className={cn('h-4 w-4 shrink-0 accent-action-primary', !selectionMode && 'hidden sm:inline-block')}
                      checked={tag.id !== undefined && selectedTagIds.has(tag.id)}
                      onChange={() => toggleTagSelected(tag.id)}
                      aria-label={`Select ${tag.name}`}
                    />
                    <DragHandle label={`Drag to reorder ${tag.name}`} dragProps={tagDrag.getHandleProps(tag.id as number)} />
                    <div
                      className='flex items-center gap-2 flex-1 min-w-0'
                      onTouchStart={() => handleTagContentTouchStart(tag.id)}
                      onTouchEnd={() => handleTagContentTouchEnd(tag.id)}
                      onTouchMove={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                    >
                      <TagChip tag={tag} />
                      <span className='flex-1 text-sm text-espresso truncate'>{tag.name}</span>
                    </div>
                    {tag.terminal ? <span className='text-[10px] text-clay/70'>Terminal</span> : null}
                    {!tag.visibleOnPatientCard ? <span className='text-[10px] text-clay/70'>Hidden on card</span> : null}
                    <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' aria-label={`Edit ${tag.name}`} onClick={() => openEditTag(tag)}>
                      <Pencil className='h-3.5 w-3.5' />
                    </Button>
                    <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-action-danger' aria-label={`Delete ${tag.name}`} onClick={() => setDeleteTagTarget(tag)}>
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={tagFormOpen} onOpenChange={setTagFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTagId !== null ? 'Edit tag' : 'New tag'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='tag-name'>Name</Label>
              <Input id='tag-name' value={tagForm.name} onChange={(event) => setTagForm({ ...tagForm, name: event.target.value })} />
            </div>

            <div className='space-y-1'>
              <Label>Display Type</Label>
              <div className='flex gap-3 text-sm'>
                <label className='flex items-center gap-1.5'>
                  <input type='radio' name='displayType' checked={tagForm.displayType === 'emoji'} onChange={() => setTagForm({ ...tagForm, displayType: 'emoji' })} />
                  Emoji
                </label>
                <label className='flex items-center gap-1.5'>
                  <input type='radio' name='displayType' checked={tagForm.displayType === 'color'} onChange={() => setTagForm({ ...tagForm, displayType: 'color' })} />
                  Text with Color
                </label>
              </div>
            </div>

            {tagForm.displayType === 'emoji' ? (
              <div className='space-y-1'>
                <Label htmlFor='tag-emoji'>Emoji</Label>
                <Input id='tag-emoji' value={tagForm.emoji} onChange={(event) => setTagForm({ ...tagForm, emoji: event.target.value })} placeholder='e.g. 🏥' className='w-24' />
              </div>
            ) : (
              <>
                <div className='space-y-1'>
                  <Label htmlFor='tag-color'>Badge color</Label>
                  <div className='flex items-center gap-1.5'>
                    <input
                      id='tag-color'
                      type='color'
                      value={/^#[0-9a-fA-F]{6}$/.test(tagForm.color) ? tagForm.color : '#c98a5e'}
                      onChange={(event) => setTagForm({ ...tagForm, color: event.target.value })}
                      className='h-9 w-12 shrink-0 rounded border border-clay/30 p-0.5'
                    />
                    <Input
                      value={tagForm.color}
                      onChange={(event) => setTagForm({ ...tagForm, color: sanitizeHexInput(event.target.value) })}
                      placeholder='#c98a5e'
                      className='w-28 font-mono text-sm'
                      maxLength={7}
                      aria-label='Badge color hex code'
                    />
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='tag-display-text'>Display text</Label>
                  <Input
                    id='tag-display-text'
                    value={tagForm.displayText}
                    onChange={(event) => setTagForm({ ...tagForm, displayText: event.target.value })}
                    placeholder={tagForm.name || 'Text shown on the badge'}
                    className='w-40'
                  />
                  <p className='text-xs text-clay'>What the badge shows (e.g. "Ref" for "Referral"). Leave blank to show the tag's name.</p>
                </div>
              </>
            )}

            <div className='space-y-1'>
              <Label>Tag Group</Label>
              <Select value={tagForm.groupId} onValueChange={(value) => setTagForm({ ...tagForm, groupId: value === '__ungrouped__' ? '' : value })}>
                <SelectTrigger><SelectValue placeholder={UNGROUPED_LABEL} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='__ungrouped__'>{UNGROUPED_LABEL}</SelectItem>
                  {sortTagGroups(groups).map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1'>
              <Label>Automation Role</Label>
              <Select value={tagForm.automationRole} onValueChange={(value) => setTagForm({ ...tagForm, automationRole: value as TagAutomationRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(AUTOMATION_ROLE_LABELS) as [TagAutomationRole, string][]).map(([role, label]) => (
                    <SelectItem key={role} value={role}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' className='h-4 w-4 accent-action-primary' checked={tagForm.visibleOnPatientCard} onChange={(event) => setTagForm({ ...tagForm, visibleOnPatientCard: event.target.checked })} />
              Visible on Patient Card
            </label>

            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' className='h-4 w-4 accent-action-primary' checked={tagForm.terminal} onChange={(event) => setTagForm({ ...tagForm, terminal: event.target.checked })} />
              Terminal flag (excludes patient from active views)
            </label>

            <div className='flex justify-end gap-2 pt-1'>
              <Button variant='ghost' onClick={() => setTagFormOpen(false)}>Cancel</Button>
              <Button onClick={() => void saveTagForm()} disabled={!tagForm.name.trim()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTagTarget !== null} onOpenChange={(open) => !open && setDeleteTagTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag "{deleteTagTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>
            {(() => {
              const count = patientCountForTag(deleteTagTarget?.id)
              return count > 0
                ? `It is currently applied to ${count} patient${count === 1 ? '' : 's'} and will be removed from all of them.`
                : 'It is not currently applied to any patients.'
            })()}
          </p>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='ghost' onClick={() => setDeleteTagTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => void confirmDeleteTag()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteGroupTarget !== null} onOpenChange={(open) => !open && setDeleteGroupTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete group "{deleteGroupTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>
            Tags in this group will move to {UNGROUPED_LABEL}. Tags themselves are not deleted.
          </p>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='ghost' onClick={() => setDeleteGroupTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => void confirmDeleteGroup()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
