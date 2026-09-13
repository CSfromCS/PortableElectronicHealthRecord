import { useState, type DragEvent, type TouchEvent } from 'react'
import { CheckCircle2, Circle, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { MentionText, PhotoMentionField, type MentionablePhoto } from '@/features/photos/photoMentions'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { FieldTip } from '@/lib/tips/FieldTip'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { dropIndicatorClassName, type DropPosition } from '@/lib/dnd/useDragReorder'
import { getMasterProblemColor } from '@/lib/color'
import { cn } from '@/lib/utils'
import type { DailyProblemNote, MasterProblem } from '@/types'

type ProblemListEditorProps = {
  dailyProblems: DailyProblemNote[]
  onChangeDailyProblems: (problems: DailyProblemNote[]) => void
  masterProblemsById: Map<number, MasterProblem>
  onAddProblem: () => void
  onRenameProblem: (masterProblemId: number, nextTitle: string) => void
  onBeginRename: (masterProblemId: number) => void
  onFinalizeRename: (masterProblemId: number, finalTitle: string) => void
  onToggleResolved: (masterProblemId: number) => void
  attachments: MentionablePhoto[]
  attachmentByTitle: Map<string, MentionablePhoto>
  onOpenPhotoById: (attachmentId: number) => void
}

const subProblemLetter = (index: number): string => String.fromCharCode(97 + index)

/** Mirrors the Master List's "1", "1a" numbering — computed from today's list order plus each
 * item's parent relationship, independent of where a sub-problem happens to sit in today's
 * (freely drag-reordered) list relative to its parent. A parent not present in today's list
 * (e.g. already resolved off it) falls back to "?" rather than a wrong number. */
const computeProblemLabels = (dailyProblems: DailyProblemNote[], masterProblemsById: Map<number, MasterProblem>): Map<number, string> => {
  const labels = new Map<number, string>()
  const topLevelNumberByProblemId = new Map<number, number>()
  let topLevelCounter = 0

  dailyProblems.forEach((entry) => {
    const problem = masterProblemsById.get(entry.masterProblemId)
    if (!problem || problem.parentId !== null) return
    topLevelCounter += 1
    topLevelNumberByProblemId.set(entry.masterProblemId, topLevelCounter)
  })

  const childCounterByParentId = new Map<number, number>()
  dailyProblems.forEach((entry) => {
    const problem = masterProblemsById.get(entry.masterProblemId)
    if (!problem) return
    if (problem.parentId === null) {
      labels.set(entry.masterProblemId, String(topLevelNumberByProblemId.get(entry.masterProblemId) ?? '?'))
      return
    }
    const childIndex = childCounterByParentId.get(problem.parentId) ?? 0
    childCounterByParentId.set(problem.parentId, childIndex + 1)
    const parentNumber = topLevelNumberByProblemId.get(problem.parentId)
    labels.set(entry.masterProblemId, `${parentNumber ?? '?'}${subProblemLetter(childIndex)}`)
  })

  return labels
}

/** Sub-problems share their top-level ancestor's color, matching the Master List. */
const resolveColorSourceId = (problem: MasterProblem, masterProblemsById: Map<number, MasterProblem>): number | null => {
  if (problem.parentId === null) return problem.id ?? null
  return masterProblemsById.get(problem.parentId)?.id ?? problem.id ?? null
}

/** Re-groups today's list so a sub-problem always immediately follows its parent, matching the
 * Master List's own layout — regardless of whatever raw order is actually stored (which the drag
 * logic below now keeps grouped anyway, but this stays self-healing against edge cases, e.g. a
 * problem added mid-list before its parent was). Restructuring (which items are sub-problems of
 * which) is the Master List's job, not this tab's — reordering here only ever happens within a
 * group (see groupKeyForEntry), never across one. */
const groupDailyProblems = (entries: DailyProblemNote[], masterProblemsById: Map<number, MasterProblem>): DailyProblemNote[] => {
  const topLevelEntries: DailyProblemNote[] = []
  const childEntriesByParentId = new Map<number, DailyProblemNote[]>()
  entries.forEach((entry) => {
    const problem = masterProblemsById.get(entry.masterProblemId)
    if (!problem) return
    if (problem.parentId === null) {
      topLevelEntries.push(entry)
    } else {
      const list = childEntriesByParentId.get(problem.parentId) ?? []
      list.push(entry)
      childEntriesByParentId.set(problem.parentId, list)
    }
  })

  const result: DailyProblemNote[] = []
  const consumedParentIds = new Set<number>()
  topLevelEntries.forEach((entry) => {
    result.push(entry)
    const problem = masterProblemsById.get(entry.masterProblemId)
    if (problem?.id === undefined) return
    consumedParentIds.add(problem.id)
    ;(childEntriesByParentId.get(problem.id) ?? []).forEach((child) => result.push(child))
  })
  // A sub-problem whose parent isn't in today's list at all — append at the end so it's never
  // silently dropped from view.
  childEntriesByParentId.forEach((children, parentId) => {
    if (consumedParentIds.has(parentId)) return
    children.forEach((child) => result.push(child))
  })
  return result
}

export function ProblemListEditor({
  dailyProblems,
  onChangeDailyProblems,
  masterProblemsById,
  onAddProblem,
  onRenameProblem,
  onBeginRename,
  onFinalizeRename,
  onToggleResolved,
  attachments,
  attachmentByTitle,
  onOpenPhotoById,
}: ProblemListEditorProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; position: DropPosition } | null>(null)
  const [pendingRemovalId, setPendingRemovalId] = useState<number | null>(null)

  // Defensive: a master problem can be permanently deleted (Master List multi-select) after it
  // was referenced on an already-saved day — hide that stale reference here rather than rendering
  // a blank, un-editable row for it.
  const visibleDailyProblems = dailyProblems.filter((entry) => masterProblemsById.has(entry.masterProblemId))
  const groupedDailyProblems = groupDailyProblems(visibleDailyProblems, masterProblemsById)
  const labels = computeProblemLabels(groupedDailyProblems, masterProblemsById)
  const groupKeyForEntry = (entry: DailyProblemNote): number | null => masterProblemsById.get(entry.masterProblemId)?.parentId ?? null

  const updateNotes = (masterProblemId: number, notes: string) => {
    onChangeDailyProblems(dailyProblems.map((entry) => (
      entry.masterProblemId === masterProblemId ? { ...entry, notes } : entry
    )))
  }

  const removeProblem = (masterProblemId: number) => {
    onChangeDailyProblems(dailyProblems.filter((entry) => entry.masterProblemId !== masterProblemId))
    setPendingRemovalId(null)
  }

  const requestRemoveProblem = (entry: DailyProblemNote) => {
    const problem = masterProblemsById.get(entry.masterProblemId)
    if (!problem?.currentTitle.trim() && !entry.notes.trim()) {
      removeProblem(entry.masterProblemId)
      return
    }
    setPendingRemovalId(entry.masterProblemId)
  }

  // Only reorders within the same group (top-level problems among themselves, or a problem's
  // sub-problems among their own siblings) — a sub-problem always tails its parent here, and
  // changing which problems are sub-problems of which is the Master List's job, not this tab's.
  const moveProblem = (sourceIndex: number, targetIndex: number, position: DropPosition) => {
    const sourceEntry = groupedDailyProblems[sourceIndex]
    const targetEntry = groupedDailyProblems[targetIndex]
    if (!sourceEntry || !targetEntry) return
    if (groupKeyForEntry(sourceEntry) !== groupKeyForEntry(targetEntry)) return
    onChangeDailyProblems(moveItemByKey(dailyProblems, (entry) => entry.masterProblemId, sourceEntry.masterProblemId, targetEntry.masterProblemId, position))
  }

  const resetDragState = () => {
    setDraggingIndex(null)
    setDropTarget(null)
  }

  const startTouchDrag = (event: TouchEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    setDraggingIndex(index)
    setDropTarget({ index, position: 'after' })
  }

  const updateTouchTarget = (event: TouchEvent<HTMLButtonElement>) => {
    if (draggingIndex === null) return
    const touchPoint = event.touches[0]
    if (!touchPoint) return
    const target = document.elementFromPoint(touchPoint.clientX, touchPoint.clientY)?.closest('[data-problem-index]')
    if (!(target instanceof HTMLElement)) return
    const targetIndex = Number.parseInt(target.dataset.problemIndex ?? '', 10)
    if (!Number.isInteger(targetIndex)) return
    event.preventDefault()
    const rect = target.getBoundingClientRect()
    const position: DropPosition = touchPoint.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ index: targetIndex, position })
  }

  const finishTouchDrag = () => {
    if (draggingIndex !== null && dropTarget !== null) {
      moveProblem(draggingIndex, dropTarget.index, dropTarget.position)
    }
    resetDragState()
  }

  const pendingRemoval = dailyProblems.find((entry) => entry.masterProblemId === pendingRemovalId) ?? null

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <div>
          <Label>Problems List</Label>
          <FieldTip>Drag blocks to set priority. Unresolved problems carry forward to the next date automatically; mark a problem Resolved once it no longer needs daily tracking.</FieldTip>
        </div>
        <Button type='button' variant='secondary' size='sm' onClick={onAddProblem}>
          <Plus className='h-4 w-4' aria-hidden='true' />
          Add problem
        </Button>
      </div>

      <div className='space-y-2'>
        {groupedDailyProblems.map((entry, index) => {
          const problem = masterProblemsById.get(entry.masterProblemId)
          const isResolved = problem?.status === 'resolved'
          const label = labels.get(entry.masterProblemId) ?? String(index + 1)
          const colorSourceId = problem ? resolveColorSourceId(problem, masterProblemsById) : null
          const color = colorSourceId !== null ? getMasterProblemColor(colorSourceId) : null
          return (
            <div
              key={entry.masterProblemId}
              data-problem-index={index}
              className={cn(
                'border-b border-clay/25 pb-3 last:border-b-0',
                draggingIndex === index && 'opacity-60',
                dropIndicatorClassName(dropTarget?.index === index && draggingIndex !== null ? dropTarget.position : null),
              )}
              onDragOver={(event) => {
                if (draggingIndex === null || draggingIndex === index) return
                const draggingEntry = groupedDailyProblems[draggingIndex]
                if (!draggingEntry || groupKeyForEntry(draggingEntry) !== groupKeyForEntry(entry)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const position: DropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                setDropTarget((previous) => (previous?.index === index && previous.position === position ? previous : { index, position }))
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggingIndex !== null) {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const position: DropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                  moveProblem(draggingIndex, index, position)
                }
                resetDragState()
              }}
            >
              <div
                className='flex items-start gap-2 rounded-md border-l-4 p-1.5'
                style={color ? { borderLeftColor: color, backgroundColor: `${color}1f` } : { borderLeftColor: 'transparent' }}
              >
                <Button
                  type='button'
                  variant='ghost'
                  className='mt-3.5 h-8 w-8 shrink-0 cursor-grab p-0 text-clay active:cursor-grabbing touch-none'
                  aria-label={`Reorder problem ${label}`}
                  draggable
                  onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                    event.dataTransfer.effectAllowed = 'move'
                    setDraggingIndex(index)
                  }}
                  onDragEnd={resetDragState}
                  onTouchStart={(event) => startTouchDrag(event, index)}
                  onTouchMove={updateTouchTarget}
                  onTouchEnd={finishTouchDrag}
                  onTouchCancel={resetDragState}
                  onKeyDown={(event) => {
                    if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                    event.preventDefault()
                    const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
                    if (targetIndex >= 0 && targetIndex < groupedDailyProblems.length) moveProblem(index, targetIndex, event.key === 'ArrowUp' ? 'before' : 'after')
                  }}
                >
                  <GripVertical className='h-4 w-4' aria-hidden='true' />
                </Button>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='shrink-0 text-sm font-medium text-espresso' aria-hidden='true'>{label}.</span>
                    <div className='min-w-0 flex-1'>
                      <TapToEditField
                        ariaLabel={`Problem ${label} title`}
                        emptyText='Tap to name this problem'
                        className='px-1.5'
                        value={problem?.currentTitle ?? ''}
                        onCommit={(nextValue) => onRenameProblem(entry.masterProblemId, nextValue)}
                        onEnterEditMode={() => onBeginRename(entry.masterProblemId)}
                        onFinalCommit={(finalValue) => onFinalizeRename(entry.masterProblemId, finalValue)}
                        renderView={(text) => (
                          <span className={isResolved ? 'line-through text-clay' : undefined}>{text}</span>
                        )}
                        renderEditor={({ value, onChange }) => (
                          <AutoGrowTextField
                            id={`problem-title-${entry.masterProblemId}`}
                            aria-label={`Problem ${label} title`}
                            value={value}
                            onChange={onChange}
                            placeholder='e.g., AKI, CAP-MR, Hyperkalemia'
                            className={cn(isResolved && 'line-through text-clay')}
                          />
                        )}
                      />
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className={cn('h-5 shrink-0 gap-0.5 px-1 text-[11px]', isResolved ? 'text-action-edit' : 'text-clay')}
                      aria-pressed={isResolved}
                      aria-label={isResolved ? `Mark problem ${label} as unresolved` : `Mark problem ${label} as resolved`}
                      onClick={() => onToggleResolved(entry.masterProblemId)}
                    >
                      {isResolved ? <CheckCircle2 className='h-3 w-3' aria-hidden='true' /> : <Circle className='h-3 w-3' aria-hidden='true' />}
                      Resolved
                    </Button>
                  </div>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  className='h-8 w-8 shrink-0 p-0 text-action-danger'
                  aria-label={`Remove problem ${label}`}
                  onClick={() => requestRemoveProblem(entry)}
                >
                  <Trash2 className='h-4 w-4' aria-hidden='true' />
                </Button>
              </div>
              <div className='mt-2 space-y-1 pl-1.5'>
                <TapToEditField
                  ariaLabel={`Notes for problem ${label}`}
                  emptyText='Tap to add notes'
                  className='px-1.5'
                  value={entry.notes}
                  onCommit={(value) => updateNotes(entry.masterProblemId, value)}
                  renderView={(text) => (
                    <MentionText text={text} attachmentByTitle={attachmentByTitle} onOpenPhotoById={onOpenPhotoById} />
                  )}
                  renderEditor={({ value, onChange }) => (
                    <PhotoMentionField
                      ariaLabel={`Notes for problem ${label}`}
                      placeholder='Plan, trend, pending workup, or other notes'
                      value={value}
                      onChange={onChange}
                      attachments={attachments}
                      attachmentByTitle={attachmentByTitle}
                      onOpenPhotoById={onOpenPhotoById}
                    />
                  )}
                />
              </div>
            </div>
          )
        })}
        {groupedDailyProblems.length === 0 ? (
          <p className='py-3 text-center text-sm text-clay'>No problems added for this date.</p>
        ) : null}
      </div>

      <Dialog open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemovalId(null) }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Remove problem?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>This removes the problem and its notes from the current daily entry.</p>
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' onClick={() => setPendingRemovalId(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => pendingRemoval && removeProblem(pendingRemoval.masterProblemId)}>Remove</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
