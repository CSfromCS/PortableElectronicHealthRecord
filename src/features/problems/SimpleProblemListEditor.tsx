import { useState, type DragEvent, type KeyboardEvent, type TouchEvent } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { TapToEditField, type TapToEditFieldKeyDownContext } from '@/lib/inlineEdit/TapToEditField'
import { FieldTip } from '@/lib/tips/FieldTip'
import { dropIndicatorClassName, type DropPosition } from '@/lib/dnd/useDragReorder'
import { getMasterProblemColor } from '@/lib/color'
import { useEntrySelection } from '@/lib/useEntrySelection'
import { cn } from '@/lib/utils'
import type { MasterProblem, SimpleProblemItem } from '@/types'

type SimpleProblemListEditorProps = {
  items: SimpleProblemItem[]
  /** Top-level, active master problems for this patient — the pickable targets for "group under
   * an existing problem" and for "ungroup from." Grouping under a brand-new problem instead
   * creates one. */
  groupableProblems: MasterProblem[]
  onAddItem: (text: string) => void
  onUpdateItemText: (itemId: number, text: string) => void
  onSplitItem: (itemId: number, fieldValue: string, caretOffset: number) => Promise<number | null>
  onMergeIntoPrevious: (itemId: number, currentText: string) => Promise<{ previousId: number; caretOffset: number } | null>
  onReorderItems: (sourceItemId: number, targetItemId: number, position: DropPosition) => void
  onDeleteItems: (itemIds: number[]) => void
  onGroupUnderExistingProblem: (itemIds: number[], masterProblemId: number) => void
  onGroupUnderNewProblem: (itemIds: number[], title: string) => void
  onUngroupFromProblem: (itemIds: number[], masterProblemId: number) => void
}

type GroupMode = 'new' | 'existing'

/** Color-codes the row for whichever problems it's grouped under — a flat tint for one, an even
 * hard-edged split (left/right/etc.) across as many bands as there are groups for more than one.
 * No problem name/chip is shown here at all — this tab is meant to be read side by side with the
 * Master List, which has the names. */
const buildGroupBackground = (groupedMasterProblemIds: number[]): string | undefined => {
  if (groupedMasterProblemIds.length === 0) return undefined
  const colors = groupedMasterProblemIds.map((id) => getMasterProblemColor(id))
  if (colors.length === 1) return `${colors[0]}40`
  const step = 100 / colors.length
  const stops = colors.flatMap((color, index) => [`${color}55 ${step * index}%`, `${color}55 ${step * (index + 1)}%`])
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function SimpleProblemListEditor({
  items,
  groupableProblems,
  onAddItem,
  onUpdateItemText,
  onSplitItem,
  onMergeIntoPrevious,
  onReorderItems,
  onDeleteItems,
  onGroupUnderExistingProblem,
  onGroupUnderNewProblem,
  onUngroupFromProblem,
}: SimpleProblemListEditorProps) {
  const [draftText, setDraftText] = useState('')
  const [pendingDeleteIds, setPendingDeleteIds] = useState<number[] | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [groupMode, setGroupMode] = useState<GroupMode>('new')
  const [newProblemTitle, setNewProblemTitle] = useState('')
  const [existingProblemId, setExistingProblemId] = useState('')
  const [ungroupTargetId, setUngroupTargetId] = useState('')
  const [autoEnterTarget, setAutoEnterTarget] = useState<{ itemId: number; caretOffset: number } | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; position: DropPosition } | null>(null)
  const selection = useEntrySelection()

  const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder)
  const allIds = sortedItems.map((item) => item.id).filter((id): id is number => id !== undefined)

  const commitDraft = () => {
    const text = draftText.trim()
    if (!text) return
    onAddItem(text)
    setDraftText('')
  }

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commitDraft()
  }

  const handleItemKeyDown = (itemId: number, event: KeyboardEvent<HTMLDivElement>, context: TapToEditFieldKeyDownContext) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      context.forceExit()
      void onSplitItem(itemId, context.fieldValue, context.caretOffset).then((newId) => {
        if (newId !== null) setAutoEnterTarget({ itemId: newId, caretOffset: 0 })
      })
    } else if (event.key === 'Backspace' && context.caretOffset === 0) {
      event.preventDefault()
      context.forceExit()
      void onMergeIntoPrevious(itemId, context.fieldValue).then((result) => {
        if (result) setAutoEnterTarget({ itemId: result.previousId, caretOffset: result.caretOffset })
      })
    }
  }

  const resetDragState = () => {
    setDraggingIndex(null)
    setDropTarget(null)
  }

  const moveItem = (sourceIndex: number, targetIndex: number, position: DropPosition) => {
    const sourceItem = sortedItems[sourceIndex]
    const targetItem = sortedItems[targetIndex]
    if (!sourceItem?.id || !targetItem?.id) return
    onReorderItems(sourceItem.id, targetItem.id, position)
  }

  const startTouchDrag = (event: TouchEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    setDraggingIndex(index)
    setDropTarget({ index, position: 'after' })
  }

  const updateTouchTarget = (event: TouchEvent<HTMLButtonElement>) => {
    if (draggingIndex === null) return
    const touch = event.touches[0]
    if (!touch) return
    const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-simple-item-index]')
    if (!(target instanceof HTMLElement)) return
    const targetIndex = Number.parseInt(target.dataset.simpleItemIndex ?? '', 10)
    if (!Number.isInteger(targetIndex)) return
    event.preventDefault()
    const rect = target.getBoundingClientRect()
    setDropTarget({ index: targetIndex, position: touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
  }

  const finishTouchDrag = () => {
    if (draggingIndex !== null && dropTarget !== null) moveItem(draggingIndex, dropTarget.index, dropTarget.position)
    resetDragState()
  }

  const openGroupDialog = () => {
    setGroupMode('new')
    setNewProblemTitle('')
    setExistingProblemId('')
    setGroupDialogOpen(true)
  }

  const confirmGroup = () => {
    const itemIds = [...selection.selectedIds]
    if (groupMode === 'new') {
      if (!newProblemTitle.trim()) return
      onGroupUnderNewProblem(itemIds, newProblemTitle.trim())
    } else {
      if (!existingProblemId) return
      onGroupUnderExistingProblem(itemIds, Number(existingProblemId))
    }
    setGroupDialogOpen(false)
    selection.exit()
  }

  const confirmUngroup = () => {
    if (!ungroupTargetId) return
    onUngroupFromProblem([...selection.selectedIds], Number(ungroupTargetId))
    setUngroupTargetId('')
    selection.exit()
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <div>
          <Label>Simple Problem List</Label>
          <FieldTip>Write one line per salient feature from the Database tab. Check items and "Group under problem" to color-code them into a Master Problem — an item can belong to more than one (shown as a split color). Enter splits a line, Backspace at the start merges it up, and the handle drags to reorder.</FieldTip>
        </div>
      </div>

      {selection.selectedIds.size > 0 ? (
        <div className='flex flex-wrap items-center gap-2 rounded-lg border border-action-primary/40 bg-action-primary/5 p-2.5'>
          <p className='text-xs font-semibold text-espresso'>{selection.selectedIds.size} selected</p>
          <div className='flex flex-wrap items-center gap-1.5 sm:ml-auto'>
            <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => selection.toggleSelectAll(allIds)}>
              {allIds.length > 0 && allIds.every((id) => selection.isSelected(id)) ? 'Deselect All' : 'Select All'}
            </Button>
            <Button size='sm' variant='outline' className='h-7 text-xs' onClick={openGroupDialog}>
              Group under problem
            </Button>
            {groupableProblems.length > 0 ? (
              <Select value={ungroupTargetId} onValueChange={setUngroupTargetId}>
                <SelectTrigger className='h-7 w-40 text-xs'>
                  <SelectValue placeholder='Ungroup from…' />
                </SelectTrigger>
                <SelectContent>
                  {groupableProblems.map((problem) => (
                    <SelectItem key={problem.id} value={String(problem.id)}>{problem.currentTitle || 'Untitled problem'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button size='sm' variant='outline' className='h-7 text-xs' disabled={!ungroupTargetId} onClick={confirmUngroup}>
              Ungroup
            </Button>
            <Button size='sm' variant='destructive' className='h-7 text-xs' onClick={() => setPendingDeleteIds([...selection.selectedIds])}>
              Delete
            </Button>
            <Button size='sm' variant='ghost' className='h-7 text-xs' onClick={selection.exit}>Cancel</Button>
          </div>
        </div>
      ) : null}

      <div>
        {sortedItems.map((item, index) => {
          if (item.id === undefined) return null
          const itemId = item.id
          const background = buildGroupBackground(item.groupedMasterProblemIds)
          return (
            <div
              key={itemId}
              data-simple-item-index={index}
              className={cn(
                'flex items-center gap-2 border-b border-clay/25 py-1 last:border-0',
                draggingIndex === index && 'opacity-60',
                dropIndicatorClassName(dropTarget?.index === index && draggingIndex !== null ? dropTarget.position : null),
              )}
              style={background ? { background } : undefined}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                if (draggingIndex === null || draggingIndex === index) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const position: DropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                setDropTarget((previous) => (previous?.index === index && previous.position === position ? previous : { index, position }))
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault()
                if (draggingIndex !== null) {
                  const rect = event.currentTarget.getBoundingClientRect()
                  moveItem(draggingIndex, index, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
                }
                resetDragState()
              }}
            >
              <input
                type='checkbox'
                className='h-4 w-4 shrink-0 accent-action-primary'
                checked={selection.isSelected(itemId)}
                onChange={() => selection.toggle(itemId)}
                aria-label={`Select item "${item.text}"`}
              />
              <Button
                type='button'
                variant='ghost'
                className='h-7 w-6 shrink-0 cursor-grab p-0 text-clay active:cursor-grabbing touch-none'
                aria-label='Reorder item'
                draggable
                onDragStart={(event: DragEvent<HTMLButtonElement>) => { event.dataTransfer.effectAllowed = 'move'; setDraggingIndex(index) }}
                onDragEnd={resetDragState}
                onTouchStart={(event) => startTouchDrag(event, index)}
                onTouchMove={updateTouchTarget}
                onTouchEnd={finishTouchDrag}
                onTouchCancel={resetDragState}
              >
                <GripVertical className='h-3.5 w-3.5' aria-hidden='true' />
              </Button>
              <div className='min-w-0 flex-1'>
                <TapToEditField
                  ariaLabel={`Simple problem item: ${item.text || 'untitled'}`}
                  emptyText='Tap to describe this salient feature'
                  className='px-1.5 py-1'
                  value={item.text}
                  onCommit={(nextValue) => onUpdateItemText(itemId, nextValue)}
                  onEditorKeyDown={(event, context) => handleItemKeyDown(itemId, event, context)}
                  autoEnter={autoEnterTarget?.itemId === itemId ? { caretOffset: autoEnterTarget.caretOffset } : null}
                  onAutoEnterHandled={() => setAutoEnterTarget(null)}
                  renderEditor={({ value, onChange }) => (
                    <AutoGrowTextField id={`simple-problem-item-${itemId}`} aria-label={`Simple problem item ${itemId}`} value={value} onChange={onChange} placeholder='e.g., WBC 14.2' />
                  )}
                />
              </div>
              <Button type='button' variant='ghost' className='h-7 w-7 shrink-0 p-0 text-action-danger' aria-label={`Delete item "${item.text}"`} onClick={() => setPendingDeleteIds([itemId])}>
                <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
              </Button>
            </div>
          )
        })}
        <div className='flex items-center gap-2 py-1'>
          <Plus className='ml-8 h-4 w-4 shrink-0 text-clay' aria-hidden='true' />
          <Input
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            onBlur={commitDraft}
            placeholder='Tap to add a salient feature'
            aria-label='Add a new salient feature'
            className='h-8 border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-1'
          />
        </div>
      </div>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Group {selection.selectedIds.size} item{selection.selectedIds.size === 1 ? '' : 's'} under a problem</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='flex gap-2'>
              <Button type='button' variant={groupMode === 'new' ? 'default' : 'outline'} size='sm' className='flex-1' onClick={() => setGroupMode('new')}>New problem</Button>
              <Button type='button' variant={groupMode === 'existing' ? 'default' : 'outline'} size='sm' className='flex-1' onClick={() => setGroupMode('existing')}>Existing problem</Button>
            </div>
            {groupMode === 'new' ? (
              <div className='space-y-1'>
                <Label htmlFor='simple-group-new-title'>Problem title</Label>
                <Input id='simple-group-new-title' value={newProblemTitle} onChange={(event) => setNewProblemTitle(event.target.value)} placeholder='e.g., Community-acquired pneumonia' />
              </div>
            ) : (
              <div className='space-y-1'>
                <Label>Problem</Label>
                <Select value={existingProblemId} onValueChange={setExistingProblemId}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select a problem' />
                  </SelectTrigger>
                  <SelectContent>
                    {groupableProblems.map((problem) => (
                      <SelectItem key={problem.id} value={String(problem.id)}>{problem.currentTitle || 'Untitled problem'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmGroup} disabled={groupMode === 'new' ? !newProblemTitle.trim() : !existingProblemId}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDeleteIds !== null} onOpenChange={(open) => { if (!open) setPendingDeleteIds(null) }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Delete {pendingDeleteIds?.length ?? 0} item{(pendingDeleteIds?.length ?? 0) === 1 ? '' : 's'}?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>This cannot be undone. Any problems already created from these items are not affected.</p>
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' onClick={() => setPendingDeleteIds(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (pendingDeleteIds) onDeleteItems(pendingDeleteIds)
                setPendingDeleteIds(null)
                selection.exit()
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
