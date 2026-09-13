import { useMemo, useState } from 'react'
import { Bookmark, ChevronLeft, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useDragReorder, dropIndicatorClassName, type DropPosition } from '@/lib/dnd/useDragReorder'
import { cn } from '@/lib/utils'
import { FieldTip } from '@/lib/tips/FieldTip'
import { BulkTagPicker } from '@/features/tags/BulkTagPicker'
import { TagChip } from '@/features/tags/TagChip'
import { isWardTagCustomized } from '@/features/tags/wardTagUtils'
import { PatientSortConfigDialog } from '@/features/patients/PatientSortConfigDialog'
import { createPatientSortLevelId } from '@/features/patients/patientSort'
import type { CustomView, PatientSortConfig, TagDefinition, TagGroupDefinition } from '@/types'
import type { TagFilterMode } from './patientFilterUtils'

type ViewDraft = {
  name: string
  tagIds: number[]
  tagMode: TagFilterMode
  wardTagIds: number[]
  sortConfig?: PatientSortConfig
}

/** Settings' own entry point for the Custom Views saved from any Tag+Ward filter dialog (Patients
 * list, Master Checklist, Reports picker) — same rename/delete already available inline there,
 * plus reordering and full tag/ward editing, matching how every other "Manage X" screen works. */
export const ManageCustomViewsScreen = ({
  views,
  tags,
  groups,
  wards,
  onBack,
}: {
  views: CustomView[]
  tags: TagDefinition[]
  groups: TagGroupDefinition[]
  wards: TagDefinition[]
  onBack: () => void
}) => {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingViewId, setEditingViewId] = useState<number | null>(null)
  const [draft, setDraft] = useState<ViewDraft | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomView | null>(null)
  const [sortDialogOpen, setSortDialogOpen] = useState(false)

  const orderedViews = [...views].sort((a, b) => a.sortOrder - b.sortOrder)
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]))
  const wardsById = new Map(wards.map((tag) => [tag.id, tag]))
  // Ward already has its own dedicated checklist below (see `wards`) — excluded from the general
  // Tags picker so it doesn't also show up there a second time. Kept in the full `tags` list
  // (unfiltered) for the sort config dialog below, which needs Ward tags selectable for a
  // "sort by ward order" tag-order level.
  const nonWardTags = useMemo(() => {
    const wardIds = new Set(wards.map((tag) => tag.id))
    return tags.filter((tag) => tag.id === undefined || !wardIds.has(tag.id))
  }, [tags, wards])

  const openCreate = () => {
    setEditingViewId(null)
    setDraft({ name: '', tagIds: [], tagMode: 'OR', wardTagIds: [] })
    setDialogOpen(true)
  }

  const openEdit = (view: CustomView) => {
    setEditingViewId(view.id ?? null)
    setDraft({ name: view.name, tagIds: view.tagIds, tagMode: view.tagMode, wardTagIds: view.wardTagIds, sortConfig: view.sortConfig })
    setDialogOpen(true)
  }

  const closeEdit = () => {
    setDialogOpen(false)
    setEditingViewId(null)
    setDraft(null)
  }

  const saveDraft = async () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) return
    if (editingViewId !== null) {
      await db.customViews.update(editingViewId, { name, tagIds: draft.tagIds, tagMode: draft.tagMode, wardTagIds: draft.wardTagIds, sortConfig: draft.sortConfig })
    } else {
      const nextSortOrder = views.length > 0 ? Math.max(...views.map((view) => view.sortOrder)) + 1 : 0
      await db.customViews.add({
        name,
        tagIds: draft.tagIds,
        tagMode: draft.tagMode,
        wardTagIds: draft.wardTagIds,
        sortConfig: draft.sortConfig,
        sortOrder: nextSortOrder,
        createdAt: new Date().toISOString(),
      })
    }
    closeEdit()
  }

  const toggleDraftTag = (tag: TagDefinition) => {
    if (!draft || tag.id === undefined) return
    const tagId = tag.id
    setDraft({
      ...draft,
      tagIds: draft.tagIds.includes(tagId) ? draft.tagIds.filter((id) => id !== tagId) : [...draft.tagIds, tagId],
    })
  }

  const toggleDraftWard = (wardTagId: number) => {
    if (!draft) return
    setDraft({
      ...draft,
      wardTagIds: draft.wardTagIds.includes(wardTagId) ? draft.wardTagIds.filter((id) => id !== wardTagId) : [...draft.wardTagIds, wardTagId],
    })
  }

  const toggleDraftUseSort = (useSort: boolean) => {
    if (!draft) return
    setDraft({ ...draft, sortConfig: useSort ? (draft.sortConfig ?? { levels: [] }) : undefined })
  }

  const confirmDelete = async () => {
    if (deleteTarget?.id === undefined) return
    await db.customViews.delete(deleteTarget.id)
    setDeleteTarget(null)
  }

  // Regenerates the sort config's own level ids (if any) so the duplicate's sort editor is fully
  // independent of the original's, matching how duplicateTemplate handles its own per-instance ids.
  const duplicateView = async (view: CustomView) => {
    const nextSortOrder = views.length > 0 ? Math.max(...views.map((v) => v.sortOrder)) + 1 : 0
    await db.customViews.add({
      name: `${view.name} (Copy)`,
      tagIds: [...view.tagIds],
      tagMode: view.tagMode,
      wardTagIds: [...view.wardTagIds],
      sortConfig: view.sortConfig ? { levels: view.sortConfig.levels.map((level) => ({ ...level, id: createPatientSortLevelId() })) } : undefined,
      sortOrder: nextSortOrder,
      createdAt: new Date().toISOString(),
    })
  }

  const reorderViews = async (sourceId: number, targetId: number, position: DropPosition) => {
    const reordered = moveItemByKey(orderedViews, (view) => view.id, sourceId, targetId, position)
    await db.transaction('rw', [db.customViews], async () => {
      await Promise.all(
        reordered.map((view, index) =>
          view.id === undefined || view.sortOrder === index ? Promise.resolve() : db.customViews.update(view.id, { sortOrder: index }),
        ),
      )
    })
  }
  const viewDrag = useDragReorder(orderedViews.map((view) => view.id as number), (source, target, position) => void reorderViews(source, target, position))

  return (
    <Card className='bg-white/80 border-clay/25 shadow-sm'>
      <CardHeader className='py-3 px-4 pb-2'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' className='h-7 w-7 p-0' onClick={onBack} aria-label='Back to Settings'>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <CardTitle className='text-base text-espresso flex-1'>Manage Custom Views</CardTitle>
          <Button size='sm' variant='outline' onClick={openCreate}>
            <Plus className='h-3.5 w-3.5 mr-1' /> New View
          </Button>
        </div>
      </CardHeader>
      <CardContent className='px-4 pb-4 space-y-3'>
        <FieldTip>
          Saved Tag+Ward filter combos, shared across the Patients list, Master Checklist, and Reports picker filters. Save one from any of those filter dialogs, or add/edit one here.
        </FieldTip>

        {orderedViews.length === 0 ? (
          <p className='text-xs text-clay'>No Custom Views saved yet — tap "New View" above to add one.</p>
        ) : (
          <div className='flex flex-col gap-1.5'>
            {orderedViews.map((view) => (
              <div
                key={view.id}
                className={cn(
                  'rounded-lg border border-clay/20 bg-warm-ivory px-2.5 py-2 transition-shadow',
                  viewDrag.isDragging(view.id as number) && 'opacity-50',
                  dropIndicatorClassName(viewDrag.dropIndicator(view.id as number)),
                )}
                {...viewDrag.getItemProps(view.id as number)}
              >
                <div className='flex items-center gap-2'>
                  <DragHandle label={`Drag to reorder ${view.name}`} dragProps={viewDrag.getHandleProps(view.id as number)} />
                  <Bookmark className='h-3.5 w-3.5 text-action-primary shrink-0' aria-hidden='true' />
                  <span className='flex-1 text-sm font-medium text-espresso truncate'>{view.name}</span>
                  <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' aria-label={`Edit ${view.name}`} onClick={() => openEdit(view)}>
                    <Pencil className='h-3.5 w-3.5' />
                  </Button>
                  <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' aria-label={`Duplicate ${view.name}`} onClick={() => void duplicateView(view)}>
                    <Copy className='h-3.5 w-3.5' />
                  </Button>
                  <Button variant='ghost' size='sm' className='h-7 w-7 p-0 text-action-danger' aria-label={`Delete ${view.name}`} onClick={() => setDeleteTarget(view)}>
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
                {view.tagIds.length > 0 || view.wardTagIds.length > 0 ? (
                  <div className='flex flex-wrap items-center gap-1 mt-1.5 pl-7'>
                    {view.tagIds.map((tagId) => {
                      const tag = tagsById.get(tagId)
                      return tag ? <TagChip key={tagId} tag={tag} /> : null
                    })}
                    {view.tagIds.length > 1 ? (
                      <span className='text-[10px] text-clay/70'>({view.tagMode === 'AND' ? 'all of these' : 'any of these'})</span>
                    ) : null}
                    {view.wardTagIds.map((wardTagId) => {
                      const ward = wardsById.get(wardTagId)
                      if (!ward) return null
                      return <span key={wardTagId} className='text-[10px] text-clay bg-clay/10 rounded-full px-1.5 py-0.5'>{ward.name}</span>
                    })}
                    {view.sortConfig ? (
                      <span className='text-[10px] text-action-primary bg-action-primary/10 rounded-full px-1.5 py-0.5'>Custom sort</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeEdit() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingViewId !== null ? 'Edit view' : 'New view'}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <>
              <ScrollArea className='max-h-[65vh] pr-3'>
                <div className='space-y-3'>
                  <div className='space-y-1'>
                    <Label htmlFor='view-name'>Name</Label>
                    <Input id='view-name' value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </div>

                  <div className='space-y-1.5'>
                    <div className='flex items-center justify-between'>
                      <Label>Tags</Label>
                      <div className='flex gap-0.5 bg-blush-sand/60 rounded-lg p-0.5 border border-clay/15'>
                        <Button
                          type='button'
                          size='sm'
                          variant={draft.tagMode === 'OR' ? 'default' : 'ghost'}
                          className='h-6 px-2 text-[11px]'
                          onClick={() => setDraft({ ...draft, tagMode: 'OR' })}
                        >
                          Any (OR)
                        </Button>
                        <Button
                          type='button'
                          size='sm'
                          variant={draft.tagMode === 'AND' ? 'default' : 'ghost'}
                          className='h-6 px-2 text-[11px]'
                          onClick={() => setDraft({ ...draft, tagMode: 'AND' })}
                        >
                          All (AND)
                        </Button>
                      </div>
                    </div>
                    <BulkTagPicker tags={nonWardTags} groups={groups} selectedTagIds={new Set(draft.tagIds)} onToggle={toggleDraftTag} />
                  </div>

                  <div className='space-y-1.5'>
                    <Label>Ward</Label>
                    {wards.length === 0 ? (
                      <p className='text-xs text-clay'>No wards recorded yet.</p>
                    ) : (
                      <div className='flex flex-col gap-1 rounded-xl border border-clay/20 bg-warm-ivory px-3 py-2'>
                        {wards.map((ward) => (
                          <label key={ward.id} className='flex items-center gap-2.5 py-1 cursor-pointer'>
                            <input
                              type='checkbox'
                              className='h-4 w-4 accent-action-primary'
                              checked={ward.id !== undefined && draft.wardTagIds.includes(ward.id)}
                              onChange={() => ward.id !== undefined && toggleDraftWard(ward.id)}
                              aria-label={`Toggle ward ${ward.name}`}
                            />
                            {isWardTagCustomized(ward) ? <TagChip tag={ward} /> : <span className='text-sm text-espresso'>{ward.name}</span>}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className='space-y-1.5'>
                    <Label>Sort</Label>
                    <label className='flex items-center gap-2.5 py-1 cursor-pointer'>
                      <input
                        type='checkbox'
                        className='h-4 w-4 accent-action-primary'
                        checked={draft.sortConfig !== undefined}
                        onChange={(event) => toggleDraftUseSort(event.target.checked)}
                        aria-label='Use a custom sort for this view'
                      />
                      <span className='text-sm text-espresso'>Use a custom sort for this view</span>
                    </label>
                    {draft.sortConfig ? (
                      <>
                        <FieldTip>Applying this view also applies this sort — leaving it unchecked leaves whatever sort is already active untouched.</FieldTip>
                        <Button type='button' variant='outline' size='sm' onClick={() => setSortDialogOpen(true)}>
                          Configure Sort…
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </ScrollArea>
              <div className='flex justify-end gap-2 pt-2'>
                <Button variant='ghost' onClick={closeEdit}>Cancel</Button>
                <Button onClick={() => void saveDraft()} disabled={!draft.name.trim() || (draft.tagIds.length === 0 && draft.wardTagIds.length === 0)}>Save</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {draft?.sortConfig ? (
        <PatientSortConfigDialog
          open={sortDialogOpen}
          onOpenChange={setSortDialogOpen}
          config={draft.sortConfig}
          onChange={(sortConfig) => setDraft(draft ? { ...draft, sortConfig } : draft)}
          tags={tags}
          groups={groups}
        />
      ) : null}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete view "{deleteTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>This only removes the saved shortcut — it doesn't affect any patients or tags.</p>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='ghost' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => void confirmDelete()}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
