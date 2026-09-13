import { useMemo, useState, type DragEvent, type TouchEvent } from 'react'
import { CheckCircle2, History, Plus, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AutoGrowTextField } from '@/lib/inlineEdit/AutoGrowTextField'
import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { FieldTip } from '@/lib/tips/FieldTip'
import { DragHandle } from '@/lib/dnd/DragHandle'
import { moveItemByKey } from '@/lib/dnd/reorderList'
import { useEntrySelection } from '@/lib/useEntrySelection'
import { getMasterProblemColor } from '@/lib/color'
import { formatPartialDateConfirmation, parsePartialDate, toLocalISODate } from '@/lib/dateTime'
import { cn } from '@/lib/utils'
import type { MasterProblem } from '@/types'

type MasterProblemListEditorProps = {
  problems: MasterProblem[]
  admitDate: string
  onAddProblem: (parentId: number | null) => void
  onRenameProblem: (masterProblemId: number, nextTitle: string) => void
  onBeginRename: (masterProblemId: number) => void
  onFinalizeRename: (masterProblemId: number, finalTitle: string) => void
  onUpdateDateIdentified: (masterProblemId: number, nextValue: string) => void
  onResolve: (masterProblemIds: number[], dateResolved: string, resolutionNotes: string, resolvedIntoId: number | null) => void
  onReopen: (masterProblemId: number) => void
  onBulkReopen: (masterProblemIds: number[]) => void
  onRemoveNameHistoryEvent: (masterProblemId: number, eventIndex: number) => void
  onReorderSiblings: (parentId: number | null, orderedIds: number[]) => void
  onTransferProblem: (masterProblemId: number, newParentId: number | null, referenceId: number, position: 'before' | 'after') => void
  onBulkPromoteToTopLevel: (masterProblemIds: number[]) => void
  onBulkMakeSubProblem: (masterProblemIds: number[], newParentId: number) => void
  onDeleteProblems: (masterProblemIds: number[]) => void
  onInvalidDate: (message: string) => void
}

const subProblemLabel = (index: number): string => String.fromCharCode(97 + index)
const NO_MERGE_TARGET = 'none'

// Shared by the header row and every data row so their cells line up exactly: handle/checkbox,
// Problem, Identified, Resolved, actions. Notes/resolution details render as a full-width line
// below the row instead of their own column, so the Problem column keeps most of the room.
// On mobile there's no room for Identified/Resolved as their own columns at all — the grid drops
// to just handle/Problem/actions there, and the dates instead render inline below the title (see
// the sm:hidden block in each row) while the desktop-only Identified/Resolved cells are hidden.
const GRID_TEMPLATE_CLASS = 'grid items-center gap-2 grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_minmax(0,1fr)_5.5rem_5.5rem_6.5rem]'

type DropZone = 'before' | 'after' | 'onto'

const computeDropZone = (clientY: number, rect: DOMRect, allowOnto: boolean): DropZone => {
  if (!allowOnto) return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  const third = rect.height / 3
  if (clientY < rect.top + third) return 'before'
  if (clientY > rect.top + third * 2) return 'after'
  return 'onto'
}

const dropZoneClassName = (zone: DropZone | null): string | undefined => {
  if (zone === 'before') return 'border-t-2 border-t-action-primary'
  if (zone === 'after') return 'border-b-2 border-b-action-primary'
  if (zone === 'onto') return 'ring-2 ring-inset ring-action-primary rounded-md'
  return undefined
}

export function MasterProblemListEditor({
  problems,
  admitDate,
  onAddProblem,
  onRenameProblem,
  onBeginRename,
  onFinalizeRename,
  onUpdateDateIdentified,
  onResolve,
  onReopen,
  onBulkReopen,
  onRemoveNameHistoryEvent,
  onReorderSiblings,
  onTransferProblem,
  onBulkPromoteToTopLevel,
  onBulkMakeSubProblem,
  onDeleteProblems,
  onInvalidDate,
}: MasterProblemListEditorProps) {
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<number>>(new Set())
  const [resolveContext, setResolveContext] = useState<{ ids: number[] } | null>(null)
  const [includeSubProblems, setIncludeSubProblems] = useState(false)
  const [dateDraft, setDateDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [resolvedIntoValue, setResolvedIntoValue] = useState<string>(NO_MERGE_TARGET)
  const [bulkTargetParentId, setBulkTargetParentId] = useState<string>('')
  const [pendingDeleteIds, setPendingDeleteIds] = useState<number[] | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: number; zone: DropZone } | null>(null)
  const selection = useEntrySelection()

  const topLevel = useMemo(
    () => problems.filter((problem) => problem.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder),
    [problems],
  )
  const childrenByParentId = useMemo(() => {
    const map = new Map<number, MasterProblem[]>()
    problems.forEach((problem) => {
      if (problem.parentId === null || problem.id === undefined) return
      const list = map.get(problem.parentId) ?? []
      list.push(problem)
      map.set(problem.parentId, list)
    })
    map.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder))
    return map
  }, [problems])

  type FlatRow = { problem: MasterProblem; label: string; colorSourceId: number; isSubProblem: boolean }
  const flatRows = useMemo(() => {
    const rows: FlatRow[] = []
    topLevel.forEach((problem, index) => {
      if (problem.id === undefined) return
      rows.push({ problem, label: String(index + 1), colorSourceId: problem.id, isSubProblem: false })
      const children = childrenByParentId.get(problem.id) ?? []
      children.forEach((child, childIndex) => {
        rows.push({ problem: child, label: `${index + 1}${subProblemLabel(childIndex)}`, colorSourceId: problem.id as number, isSubProblem: true })
      })
    })
    return rows
  }, [topLevel, childrenByParentId])

  const labelByProblemId = useMemo(() => new Map(flatRows.map((row) => [row.problem.id as number, row.label])), [flatRows])
  const hasChildren = (id: number) => problems.some((problem) => problem.parentId === id)

  const toggleHistory = (id: number) => {
    setExpandedHistoryIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resetDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

  const findSiblingIds = (parentId: number | null): number[] => problems
    .filter((problem) => problem.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((problem) => problem.id)
    .filter((id): id is number => id !== undefined)

  const handleDrop = (targetId: number) => {
    const sourceId = draggingId
    const zone = dropTarget?.id === targetId ? dropTarget.zone : null
    resetDrag()
    if (sourceId === null || zone === null || sourceId === targetId) return
    const sourceProblem = problems.find((problem) => problem.id === sourceId)
    const targetProblem = problems.find((problem) => problem.id === targetId)
    if (!sourceProblem || !targetProblem) return

    if (zone === 'onto') {
      if (targetProblem.parentId !== null || hasChildren(sourceId)) return
      onBulkMakeSubProblem([sourceId], targetId)
      return
    }
    // before/after: reorders in place when source and target already share a parent, or
    // transfers the dragged problem to the target's parent (un-nesting it to top-level when the
    // target is itself top-level, or moving it to a different main problem's sub-problems) —
    // one operation covers both, since a same-parent "transfer" is just a reorder.
    onTransferProblem(sourceId, targetProblem.parentId, targetId, zone)
  }

  const startTouchDrag = (event: TouchEvent<HTMLButtonElement>, id: number) => {
    event.preventDefault()
    setDraggingId(id)
    setDropTarget(null)
  }

  const updateTouchTarget = (event: TouchEvent<HTMLButtonElement>) => {
    if (draggingId === null) return
    const touch = event.touches[0]
    if (!touch) return
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-mpl-row-id]')
    if (!(targetEl instanceof HTMLElement)) return
    const targetId = Number(targetEl.dataset.mplRowId)
    if (!Number.isFinite(targetId) || targetId === draggingId) return
    event.preventDefault()
    const targetProblem = problems.find((problem) => problem.id === targetId)
    const allowOnto = targetProblem?.parentId === null && !hasChildren(draggingId)
    setDropTarget({ id: targetId, zone: computeDropZone(touch.clientY, targetEl.getBoundingClientRect(), allowOnto) })
  }

  const finishTouchDrag = () => {
    if (dropTarget) handleDrop(dropTarget.id)
    else resetDrag()
  }

  const openResolveDialog = (ids: number[]) => {
    setResolveContext({ ids })
    setIncludeSubProblems(false)
    setDateDraft('')
    setNotesDraft('')
    setResolvedIntoValue(NO_MERGE_TARGET)
  }

  const singleResolveChildren = resolveContext?.ids.length === 1 ? (childrenByParentId.get(resolveContext.ids[0]) ?? []) : []

  const confirmResolve = () => {
    if (!resolveContext) return
    let dateResolved = toLocalISODate()
    if (dateDraft.trim()) {
      const parsed = parsePartialDate(dateDraft)
      if (!parsed.ok) {
        onInvalidDate(parsed.error)
        return
      }
      dateResolved = parsed.value
    }
    const childIds = includeSubProblems
      ? singleResolveChildren.map((child) => child.id).filter((id): id is number => id !== undefined)
      : []
    const resolvedIntoId = resolvedIntoValue === NO_MERGE_TARGET ? null : Number(resolvedIntoValue)
    onResolve([...resolveContext.ids, ...childIds], dateResolved, notesDraft, resolvedIntoId)
    setResolveContext(null)
  }

  const commitDateIdentified = (masterProblemId: number, raw: string) => {
    if (!raw.trim()) {
      onUpdateDateIdentified(masterProblemId, '')
      return
    }
    const result = parsePartialDate(raw)
    if (result.ok) onUpdateDateIdentified(masterProblemId, result.value)
    else onInvalidDate(result.error)
  }

  const allSelectableIds = flatRows.map((row) => row.problem.id).filter((id): id is number => id !== undefined)
  const selectedIdsHaveChildren = [...selection.selectedIds].some((id) => hasChildren(id))
  const bulkTargetCandidates = topLevel.filter((problem) => problem.id !== undefined && !selection.selectedIds.has(problem.id))
  const admitDateDisplay = formatPartialDateConfirmation(admitDate || toLocalISODate())

  const bulkDeleteIds = (ids: number[]): number[] => {
    const set = new Set(ids)
    problems.forEach((problem) => {
      if (problem.parentId !== null && set.has(problem.parentId) && problem.id !== undefined) set.add(problem.id)
    })
    return [...set]
  }

  const renderRow = ({ problem, label, colorSourceId, isSubProblem }: FlatRow) => {
    if (problem.id === undefined) return null
    const problemId = problem.id
    const isResolved = problem.status === 'resolved'
    const resolvedIntoTitle = problem.mergedIntoId !== null
      ? problems.find((candidate) => candidate.id === problem.mergedIntoId)?.currentTitle || 'another problem'
      : null
    const color = getMasterProblemColor(colorSourceId)
    const hasHistoryEntries = problem.nameHistory.length > 0
    const historyExpanded = expandedHistoryIds.has(problemId)
    const zone = dropTarget?.id === problemId ? dropTarget.zone : null

    return (
      <div
        key={problemId}
        data-mpl-row-id={problemId}
        className={cn('rounded-md', selection.selectionMode && 'cursor-pointer')}
        style={{ borderLeft: `4px solid ${color}`, backgroundColor: `${color}1f` }}
        onClick={selection.selectionMode ? () => selection.toggle(problemId) : undefined}
      >
        <div
          className={cn(GRID_TEMPLATE_CLASS, 'rounded-md p-2', draggingId === problemId && 'opacity-50', dropZoneClassName(zone))}
          onDragOver={(event: DragEvent<HTMLDivElement>) => {
            if (draggingId === null || draggingId === problemId) return
            event.preventDefault()
            const allowOnto = problem.parentId === null && !hasChildren(draggingId)
            const nextZone = computeDropZone(event.clientY, event.currentTarget.getBoundingClientRect(), allowOnto)
            setDropTarget((previous) => (previous?.id === problemId && previous.zone === nextZone ? previous : { id: problemId, zone: nextZone }))
          }}
          onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); handleDrop(problemId) }}
        >
          {selection.selectionMode ? (
            <input
              type='checkbox'
              className='mt-1 h-4 w-4 shrink-0 accent-action-primary'
              checked={selection.isSelected(problemId)}
              onChange={() => selection.toggle(problemId)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Select problem ${label}`}
            />
          ) : (
            <DragHandle
              label={`Reorder or nest problem ${label}`}
              className='mt-0.5'
              dragProps={{
                draggable: true,
                onDragStart: (event: DragEvent<HTMLButtonElement>) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(problemId) },
                onDragEnd: resetDrag,
                onTouchStart: (event) => startTouchDrag(event, problemId),
                onTouchMove: updateTouchTarget,
                onTouchEnd: finishTouchDrag,
                onTouchCancel: resetDrag,
                onKeyDown: (event) => {
                  if (!(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                  event.preventDefault()
                  const siblingIds = findSiblingIds(problem.parentId)
                  const index = siblingIds.indexOf(problemId)
                  const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
                  const targetId = siblingIds[targetIndex]
                  if (targetId === undefined) return
                  onReorderSiblings(problem.parentId, moveItemByKey(siblingIds, (id) => id, problemId, targetId, event.key === 'ArrowUp' ? 'before' : 'after'))
                },
              }}
            />
          )}

          <div className='min-w-0' style={{ paddingLeft: isSubProblem ? '1.25rem' : 0 }}>
            <div className='flex items-baseline gap-1.5'>
              <span className='shrink-0 text-sm font-semibold text-espresso'>{label}.</span>
              <div className='min-w-0 flex-1'>
                {selection.selectionMode ? (
                  <span className={cn('block px-1.5 py-1 font-medium', isResolved && 'line-through text-clay', !problem.currentTitle.trim() && 'text-clay/60')}>
                    {problem.currentTitle.trim() || 'Untitled problem'}
                  </span>
                ) : (
                  <TapToEditField
                    ariaLabel={`Problem ${label} title`}
                    emptyText='Tap to name this problem'
                    className='px-1.5 py-1'
                    value={problem.currentTitle}
                    onCommit={(nextValue) => onRenameProblem(problemId, nextValue)}
                    onEnterEditMode={() => onBeginRename(problemId)}
                    onFinalCommit={(finalValue) => onFinalizeRename(problemId, finalValue)}
                    renderView={(text) => <span className={cn('font-medium', isResolved && 'line-through text-clay')}>{text}</span>}
                    renderEditor={({ value, onChange }) => (
                      <AutoGrowTextField
                        id={`master-problem-title-${problemId}`}
                        aria-label={`Problem ${label} title`}
                        value={value}
                        onChange={onChange}
                        placeholder='e.g., AKI, CAP-MR, Hyperkalemia'
                        className={cn(isResolved && 'line-through text-clay')}
                      />
                    )}
                  />
                )}
              </div>
            </div>
            <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-clay sm:hidden'>
              <span className='flex items-center gap-1'>
                Identified:
                {selection.selectionMode ? (
                  <span>{problem.dateIdentified ? formatPartialDateConfirmation(problem.dateIdentified) : admitDateDisplay}</span>
                ) : (
                  <TapToEditField
                    ariaLabel={`Date identified for problem ${label}`}
                    emptyText={admitDateDisplay}
                    className='px-1 py-0'
                    value={problem.dateIdentified}
                    onCommit={(nextValue) => commitDateIdentified(problemId, nextValue)}
                    renderView={(text) => <span>{formatPartialDateConfirmation(text)}</span>}
                    renderEditor={({ value, onChange }) => (
                      <AutoGrowTextField id={`master-problem-identified-mobile-${problemId}`} aria-label={`Date identified for problem ${label}`} value={value} onChange={onChange} placeholder={admitDateDisplay} />
                    )}
                  />
                )}
              </span>
              {isResolved ? <span>Resolved: {formatPartialDateConfirmation(problem.dateResolved ?? '')}</span> : null}
            </div>
            {hasHistoryEntries && historyExpanded ? (
              <ul className='mt-1 space-y-0.5 text-[11px] text-clay'>
                {problem.nameHistory.map((event, index) => (
                  <li key={`${event.name}-${event.changedAt}-${index}`} className='flex items-center gap-1.5'>
                    <span>{event.name} (until {event.changedAt})</span>
                    {selection.selectionMode ? null : (
                      <button type='button' aria-label={`Remove history entry "${event.name}"`} className='text-clay/70 hover:text-action-danger' onClick={(event) => { event.stopPropagation(); onRemoveNameHistoryEvent(problemId, index) }}>
                        <X className='h-3 w-3' aria-hidden='true' />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className='hidden text-right text-[11px] text-clay sm:block'>
            {selection.selectionMode ? (
              <span className='block px-1 py-0.5'>{problem.dateIdentified ? formatPartialDateConfirmation(problem.dateIdentified) : admitDateDisplay}</span>
            ) : (
              <TapToEditField
                ariaLabel={`Date identified for problem ${label}`}
                emptyText={admitDateDisplay}
                className='px-1 py-0.5 text-[11px] text-right'
                value={problem.dateIdentified}
                onCommit={(nextValue) => commitDateIdentified(problemId, nextValue)}
                renderView={(text) => <span>{formatPartialDateConfirmation(text)}</span>}
                renderEditor={({ value, onChange }) => (
                  <AutoGrowTextField id={`master-problem-identified-${problemId}`} aria-label={`Date identified for problem ${label}`} value={value} onChange={onChange} placeholder={admitDateDisplay} className='text-right' />
                )}
              />
            )}
          </div>

          <div className='hidden px-1 py-0.5 text-right text-[11px] text-clay sm:block'>
            {isResolved ? formatPartialDateConfirmation(problem.dateResolved ?? '') : ''}
          </div>

          <div className='flex shrink-0 items-center gap-0.5'>
            {selection.selectionMode ? null : (
              <>
                {isResolved ? (
                  <Button type='button' variant='ghost' size='sm' className='h-7 w-7 p-0 text-action-edit' title='Reopen' aria-label={`Reopen problem ${label}`} onClick={() => onReopen(problemId)}>
                    <RotateCcw className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                ) : (
                  <Button type='button' variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' title='Resolve' aria-label={`Resolve problem ${label}`} onClick={() => openResolveDialog([problemId])}>
                    <CheckCircle2 className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                )}
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className={cn('h-7 w-7 p-0', hasHistoryEntries ? 'text-clay' : 'text-clay/30')}
                  disabled={!hasHistoryEntries}
                  title={hasHistoryEntries ? 'Show/hide rename history' : 'No rename history yet'}
                  aria-label={`Show or hide rename history for problem ${label}`}
                  onClick={() => toggleHistory(problemId)}
                >
                  <History className='h-3.5 w-3.5' aria-hidden='true' />
                </Button>
                {!isSubProblem ? (
                  <Button type='button' variant='ghost' size='sm' className='h-7 w-7 p-0 text-clay' title='Add sub-problem' aria-label={`Add a sub-problem under problem ${label}`} onClick={() => onAddProblem(problemId)}>
                    <Plus className='h-3.5 w-3.5' aria-hidden='true' />
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
        {isResolved && (resolvedIntoTitle || problem.resolutionNotes) ? (
          <p className='px-2 pb-2 text-[11px] text-clay' style={{ paddingLeft: `calc(2.25rem + ${isSubProblem ? '1.25rem' : '0px'})` }}>
            {resolvedIntoTitle ? `Resolved → ${labelByProblemId.get(problem.mergedIntoId as number) ?? ''}. ${resolvedIntoTitle}` : ''}
            {resolvedIntoTitle && problem.resolutionNotes ? ' — ' : ''}
            {problem.resolutionNotes}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <div>
          <div className='flex items-center gap-1.5'>
            <Label>Master Problem List</Label>
            <Badge className='border-amber-200 bg-amber-100 text-amber-700'>Prototype — desktop only</Badge>
          </div>
          <FieldTip>Tap the + on a problem to add a sub-problem under it. Tap the checkmark to resolve, or the rotate icon to reopen. Drag the handle to reorder — drop a problem onto a main problem (middle of the row) to nest it as a sub-problem, or near a row's top/bottom edge to reorder or move it back out. Select problems to resolve, reopen, delete, or promote/demote several at once.</FieldTip>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {!selection.selectionMode ? (
            <Button type='button' variant='outline' size='sm' onClick={() => selection.setSelectionMode(true)}>Select</Button>
          ) : null}
          <Button type='button' variant='secondary' size='sm' onClick={() => onAddProblem(null)}>
            <Plus className='h-4 w-4' aria-hidden='true' />
            Add problem
          </Button>
        </div>
      </div>

      {selection.selectionMode ? (
        <div className='flex flex-wrap items-center gap-2 rounded-lg border border-action-primary/40 bg-action-primary/5 p-2.5'>
          <p className='text-xs font-semibold text-espresso'>{selection.selectedIds.size} selected</p>
          <div className='flex flex-wrap items-center gap-1.5 sm:ml-auto'>
            <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => selection.toggleSelectAll(allSelectableIds)}>
              {allSelectableIds.length > 0 && allSelectableIds.every((id) => selection.isSelected(id)) ? 'Deselect All' : 'Select All'}
            </Button>
            <Button size='sm' variant='outline' className='h-7 text-xs' disabled={selection.selectedIds.size === 0} onClick={() => openResolveDialog([...selection.selectedIds])}>
              Resolve
            </Button>
            <Button size='sm' variant='outline' className='h-7 text-xs' disabled={selection.selectedIds.size === 0} onClick={() => { onBulkReopen([...selection.selectedIds]); selection.exit() }}>
              Reopen
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='h-7 text-xs'
              disabled={selection.selectedIds.size === 0}
              onClick={() => { onBulkPromoteToTopLevel([...selection.selectedIds]); selection.exit() }}
            >
              Promote to top-level
            </Button>
            <Select value={bulkTargetParentId} onValueChange={setBulkTargetParentId}>
              <SelectTrigger className='h-7 w-44 text-xs'>
                <SelectValue placeholder='Make sub-problem of…' />
              </SelectTrigger>
              <SelectContent>
                {bulkTargetCandidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={String(candidate.id)}>{labelByProblemId.get(candidate.id as number)}. {candidate.currentTitle || 'Untitled problem'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size='sm'
              variant='outline'
              className='h-7 text-xs'
              disabled={selection.selectedIds.size === 0 || !bulkTargetParentId || selectedIdsHaveChildren}
              title={selectedIdsHaveChildren ? 'A selected problem already has sub-problems of its own — promote those first.' : undefined}
              onClick={() => { onBulkMakeSubProblem([...selection.selectedIds], Number(bulkTargetParentId)); selection.exit(); setBulkTargetParentId('') }}
            >
              Make sub-problem
            </Button>
            <Button
              size='sm'
              variant='destructive'
              className='h-7 text-xs'
              disabled={selection.selectedIds.size === 0}
              onClick={() => setPendingDeleteIds(bulkDeleteIds([...selection.selectedIds]))}
            >
              Delete
            </Button>
            <Button size='sm' variant='ghost' className='h-7 text-xs' onClick={selection.exit}>Cancel</Button>
          </div>
        </div>
      ) : null}

      <div className='space-y-2'>
        {topLevel.length === 0 ? (
          <p className='py-3 text-center text-sm text-clay'>No problems added yet.</p>
        ) : (
          <div className={cn(GRID_TEMPLATE_CLASS, 'hidden px-2 text-[11px] font-semibold uppercase tracking-wide text-clay/70 sm:grid')}>
            <span />
            <span>Problem</span>
            <span className='text-right'>Identified</span>
            <span className='text-right'>Resolved</span>
            <span />
          </div>
        )}
        {flatRows.map((row) => renderRow(row))}
      </div>

      <Dialog open={resolveContext !== null} onOpenChange={(open) => { if (!open) setResolveContext(null) }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Resolve {resolveContext && resolveContext.ids.length > 1 ? `${resolveContext.ids.length} problems` : 'problem'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            {singleResolveChildren.length > 0 ? (
              <label className='flex items-center gap-2 text-sm'>
                <input type='checkbox' className='h-4 w-4 accent-action-primary' checked={includeSubProblems} onChange={(event) => setIncludeSubProblems(event.target.checked)} />
                Also resolve {singleResolveChildren.length} sub-problem{singleResolveChildren.length === 1 ? '' : 's'}
              </label>
            ) : null}
            <div className='space-y-1'>
              <Label htmlFor='master-problem-resolved-date'>Date resolved</Label>
              <Input id='master-problem-resolved-date' value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} placeholder={formatPartialDateConfirmation(toLocalISODate())} />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='master-problem-resolved-notes'>Notes</Label>
              <AutoGrowTextField id='master-problem-resolved-notes' aria-label='Resolution notes' value={notesDraft} onChange={setNotesDraft} placeholder='e.g., afebrile x3 days' />
            </div>
            <div className='space-y-1'>
              <Label>Resolved into</Label>
              <Select value={resolvedIntoValue} onValueChange={setResolvedIntoValue}>
                <SelectTrigger>
                  <SelectValue placeholder='None' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MERGE_TARGET}>None — resolved on its own</SelectItem>
                  {problems.filter((candidate) => candidate.id !== undefined && !resolveContext?.ids.includes(candidate.id) && candidate.status === 'active').map((candidate) => (
                    <SelectItem key={candidate.id} value={String(candidate.id)}>{labelByProblemId.get(candidate.id as number)}. {candidate.currentTitle || 'Untitled problem'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' onClick={() => setResolveContext(null)}>Cancel</Button>
            <Button onClick={confirmResolve}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDeleteIds !== null} onOpenChange={(open) => { if (!open) setPendingDeleteIds(null) }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Delete {pendingDeleteIds?.length ?? 0} problem{(pendingDeleteIds?.length ?? 0) === 1 ? '' : 's'}?</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-espresso'>This permanently deletes the problem (and any of its sub-problems) from the Master List and any daily entries that reference it. This cannot be undone.</p>
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' onClick={() => setPendingDeleteIds(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (pendingDeleteIds) onDeleteProblems(pendingDeleteIds)
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
