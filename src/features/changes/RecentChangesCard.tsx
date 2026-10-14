import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ChangeLogEntry } from '@/types'
import { CHANGE_LOG_RETENTION_DAYS, listChanges, undoChange } from './changeLog'

const formatWhen = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const describeCounts = (entry: ChangeLogEntry): string => {
  const counts = { add: 0, update: 0, delete: 0 }
  entry.ops.forEach((op) => { counts[op.kind] += 1 })
  return [
    counts.add ? `${counts.add} added` : '',
    counts.update ? `${counts.update} edited` : '',
    counts.delete ? `${counts.delete} deleted` : '',
  ].filter(Boolean).join(', ')
}

/**
 * What Medmin changed, newest first, each with an Undo. Shows nothing until there's something to
 * show. A deleted patient or entry stays here for 30 days, which is what makes it recoverable.
 */
export function RecentChangesCard() {
  const entries = useLiveQuery(() => listChanges(15), [])
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [isWorking, setIsWorking] = useState(false)

  if (!entries || entries.length === 0) return null

  const runUndo = async (entry: ChangeLogEntry, force: boolean) => {
    if (entry.id === undefined) return
    setIsWorking(true)
    try {
      const outcome = await undoChange(entry.id, { force })
      if (outcome.undone) {
        setConfirmingId(null)
        setConflicts([])
        setMessage('Undone.')
      } else {
        setConflicts(outcome.conflicts)
        setMessage('')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to undo.')
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className='space-y-2'>
      <p className='text-[11px] font-bold uppercase tracking-widest text-clay/55'>Recent Medmin changes</p>
      <div className='rounded-xl border border-clay/25 bg-warm-ivory px-3.5 py-3 space-y-3'>
        <p className='text-[11px] text-clay'>
          Everything Medmin changed in PUHRR. Undo puts it back, including deleted patients and entries, for {CHANGE_LOG_RETENTION_DAYS} days.
        </p>
        {message ? <p className='text-xs text-espresso'>{message}</p> : null}
        <ul className='space-y-2.5'>
          {entries.map((entry) => (
            <li key={entry.id} className='space-y-1'>
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <p className='text-sm text-espresso'>{entry.summary}</p>
                  <p className='text-[11px] text-clay'>
                    {formatWhen(entry.at)}{entry.patientIdentifier ? ` · ${entry.patientIdentifier}` : ''} · {describeCounts(entry)}
                  </p>
                </div>
                {entry.undoneAt ? (
                  <Badge className='bg-clay/15 text-clay border-clay/30 shrink-0'>Undone</Badge>
                ) : (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='gap-1.5 border-clay/35 shrink-0'
                    disabled={isWorking}
                    onClick={() => { setConfirmingId(entry.id ?? null); setConflicts([]); setMessage('') }}
                  >
                    <Undo2 className='h-3.5 w-3.5' />
                    Undo
                  </Button>
                )}
              </div>
              {confirmingId === entry.id && !entry.undoneAt ? (
                <div className='rounded-lg bg-blush-sand/60 border border-clay/20 px-3 py-2 space-y-2'>
                  {conflicts.length > 0 ? (
                    <>
                      <p className='text-xs text-espresso'>This was edited again afterwards, so undoing it would overwrite that: {conflicts.join('; ')}.</p>
                      <div className='flex gap-2'>
                        <Button type='button' size='sm' variant='destructive' disabled={isWorking} onClick={() => void runUndo(entry, true)}>Undo anyway</Button>
                        <Button type='button' size='sm' variant='secondary' onClick={() => setConfirmingId(null)}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className='text-xs text-espresso'>Undo: {entry.summary}</p>
                      <div className='flex gap-2'>
                        <Button type='button' size='sm' disabled={isWorking} onClick={() => void runUndo(entry, false)}>Yes, undo</Button>
                        <Button type='button' size='sm' variant='secondary' onClick={() => setConfirmingId(null)}>Cancel</Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
