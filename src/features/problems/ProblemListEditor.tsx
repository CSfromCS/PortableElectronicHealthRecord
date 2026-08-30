import { useState, type DragEvent, type TouchEvent } from 'react'
import { CheckCircle2, Circle, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MentionText, PhotoMentionField, type MentionablePhoto } from '@/features/photos/photoMentions'
import { TapToEditField } from '@/lib/inlineEdit/TapToEditField'
import { cn } from '@/lib/utils'
import type { ProblemBlock } from '@/types'
import { createProblemBlockId } from './problemUtils'

type ProblemListEditorProps = {
  problems: ProblemBlock[]
  onChange: (problems: ProblemBlock[]) => void
  attachments: MentionablePhoto[]
  attachmentByTitle: Map<string, MentionablePhoto>
  onOpenPhotoById: (attachmentId: number) => void
}

const reorderProblems = (problems: ProblemBlock[], sourceIndex: number, targetIndex: number) => {
  if (sourceIndex === targetIndex || !problems[sourceIndex] || !problems[targetIndex]) return problems
  const nextProblems = [...problems]
  const [movedProblem] = nextProblems.splice(sourceIndex, 1)
  nextProblems.splice(targetIndex, 0, movedProblem)
  return nextProblems
}

export function ProblemListEditor({
  problems,
  onChange,
  attachments,
  attachmentByTitle,
  onOpenPhotoById,
}: ProblemListEditorProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [touchTargetIndex, setTouchTargetIndex] = useState<number | null>(null)
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)

  const updateProblem = (id: string, field: 'title' | 'notes', value: string) => {
    onChange(problems.map((problem) => (
      problem.id === id ? { ...problem, [field]: value } : problem
    )))
  }

  const toggleProblemCompleted = (id: string) => {
    onChange(problems.map((problem) => (
      problem.id === id ? { ...problem, completed: !problem.completed } : problem
    )))
  }

  const removeProblem = (id: string) => {
    onChange(problems.filter((problem) => problem.id !== id))
    setPendingRemovalId(null)
  }

  const requestRemoveProblem = (problem: ProblemBlock) => {
    if (!problem.title.trim() && !problem.notes.trim()) {
      removeProblem(problem.id)
      return
    }
    setPendingRemovalId(problem.id)
  }

  const moveProblem = (sourceIndex: number, targetIndex: number) => {
    onChange(reorderProblems(problems, sourceIndex, targetIndex))
  }

  const resetDragState = () => {
    setDraggingIndex(null)
    setTouchTargetIndex(null)
  }

  const startTouchDrag = (event: TouchEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    setDraggingIndex(index)
    setTouchTargetIndex(index)
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
    setTouchTargetIndex(targetIndex)
  }

  const finishTouchDrag = () => {
    if (draggingIndex !== null && touchTargetIndex !== null) {
      moveProblem(draggingIndex, touchTargetIndex)
    }
    resetDragState()
  }

  const pendingRemoval = problems.find((problem) => problem.id === pendingRemovalId) ?? null

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <div>
          <Label>Problems List</Label>
          <p className='text-xs text-clay'>Drag blocks to set priority. Unresolved problems carry forward to the next date automatically; mark a problem Resolved once it no longer needs daily tracking.</p>
        </div>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          onClick={() => onChange([...problems, { id: createProblemBlockId(), title: '', notes: '', completed: false }])}
        >
          <Plus className='h-4 w-4' aria-hidden='true' />
          Add problem
        </Button>
      </div>

      <div className='space-y-2'>
        {problems.map((problem, index) => (
          <div
            key={problem.id}
            data-problem-index={index}
            className={cn(
              'border-b border-clay/25 pb-3 last:border-b-0',
              draggingIndex === index && 'opacity-60',
              touchTargetIndex === index && draggingIndex !== null && 'ring-2 ring-action-primary/40 ring-offset-2',
            )}
            onDragOver={(event) => {
              if (draggingIndex === null || draggingIndex === index) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggingIndex !== null) moveProblem(draggingIndex, index)
              resetDragState()
            }}
          >
            <div className='flex items-start gap-2'>
              <Button
                type='button'
                variant='ghost'
                className='mt-5 h-8 w-8 shrink-0 cursor-grab p-0 text-clay active:cursor-grabbing touch-none'
                aria-label={`Reorder problem ${index + 1}`}
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
                  if (targetIndex >= 0 && targetIndex < problems.length) moveProblem(index, targetIndex)
                }}
              >
                <GripVertical className='h-4 w-4' aria-hidden='true' />
              </Button>
              <div className='min-w-0 flex-1 space-y-2'>
                <div className='flex items-center gap-2'>
                  <span className='shrink-0 text-sm font-medium text-clay' aria-hidden='true'>{index + 1}.</span>
                  <div className='min-w-0 flex-1'>
                    <TapToEditField
                      ariaLabel={`Problem ${index + 1} title`}
                      emptyText='Tap to name this problem'
                      value={problem.title}
                      onCommit={(nextValue) => updateProblem(problem.id, 'title', nextValue)}
                      renderView={(text) => (
                        <span className={problem.completed ? 'line-through text-clay' : undefined}>{text}</span>
                      )}
                      renderEditor={({ value, onChange }) => (
                        <Input
                          id={`problem-title-${problem.id}`}
                          aria-label={`Problem ${index + 1} title`}
                          value={value}
                          onChange={(event) => onChange(event.target.value)}
                          placeholder='e.g., AKI, CAP-MR, Hyperkalemia'
                          className={cn(problem.completed && 'line-through text-clay')}
                        />
                      )}
                    />
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className={cn('h-6 shrink-0 gap-1 px-1.5 text-xs', problem.completed ? 'text-action-edit' : 'text-clay')}
                    aria-pressed={problem.completed}
                    onClick={() => toggleProblemCompleted(problem.id)}
                  >
                    {problem.completed ? <CheckCircle2 className='h-3.5 w-3.5' aria-hidden='true' /> : <Circle className='h-3.5 w-3.5' aria-hidden='true' />}
                    {problem.completed ? 'Resolved' : 'Mark resolved'}
                  </Button>
                </div>
                <div className='space-y-1'>
                  <TapToEditField
                    ariaLabel={`Notes for problem ${index + 1}`}
                    emptyText='Tap to add notes'
                    value={problem.notes}
                    onCommit={(value) => updateProblem(problem.id, 'notes', value)}
                    renderView={(text) => (
                      <MentionText text={text} attachmentByTitle={attachmentByTitle} onOpenPhotoById={onOpenPhotoById} />
                    )}
                    renderEditor={({ value, onChange }) => (
                      <PhotoMentionField
                        ariaLabel={`Notes for problem ${index + 1}`}
                        placeholder='Plan, trend, pending workup, or other notes'
                        className='min-h-28'
                        value={value}
                        onChange={onChange}
                        autoExpand
                        attachments={attachments}
                        attachmentByTitle={attachmentByTitle}
                        onOpenPhotoById={onOpenPhotoById}
                      />
                    )}
                  />
                </div>
              </div>
              <Button
                type='button'
                variant='ghost'
                className='mt-5 h-8 w-8 shrink-0 p-0 text-action-danger'
                aria-label={`Remove problem ${index + 1}`}
                onClick={() => requestRemoveProblem(problem)}
              >
                <Trash2 className='h-4 w-4' aria-hidden='true' />
              </Button>
            </div>
          </div>
        ))}
        {problems.length === 0 ? (
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
            <Button variant='destructive' onClick={() => pendingRemoval && removeProblem(pendingRemoval.id)}>Remove</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}