import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getResetCounts, type ResetCounts, type ResetGroupId, type ResetSelection } from './syncReset'

const CONFIRM_WORD = 'RESET'

const DEFAULT_SELECTION: ResetSelection = {
  patients: true,
  tagHistory: true,
  changeLog: true,
  deletionHistory: false,
  photos: true,
}

type ResetRoomDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether this device is linked to a sync room, which changes what the reset means. */
  syncEnabled: boolean
  /** Downloads a backup of everything. Must throw if it could not be made, so the reset is skipped. */
  onExportBackup: () => Promise<void>
  onReset: (selection: ResetSelection) => Promise<void>
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`

export function ResetRoomDialog({ open, onOpenChange, syncEnabled, onExportBackup, onReset }: ResetRoomDialogProps) {
  const [selection, setSelection] = useState<ResetSelection>(DEFAULT_SELECTION)
  const [counts, setCounts] = useState<ResetCounts | null>(null)
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [typedWord, setTypedWord] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return undefined
    setSelection(DEFAULT_SELECTION)
    setStep('choose')
    setTypedWord('')
    setError(null)
    setCounts(null)

    let cancelled = false
    void getResetCounts().then((next) => {
      if (!cancelled) setCounts(next)
    })
    return () => { cancelled = true }
  }, [open])

  // Patients take their tag history with them, so that row follows the patients row.
  const isChecked = (id: ResetGroupId) => (id === 'tagHistory' ? selection.patients || selection.tagHistory : selection[id])
  const hasSelection = (Object.keys(selection) as ResetGroupId[]).some(isChecked)

  const toggle = (id: ResetGroupId) => setSelection((previous) => ({ ...previous, [id]: !previous[id] }))

  const rows: Array<{ id: ResetGroupId; label: string; detail: string }> = [
    {
      id: 'patients',
      label: 'Patients and all their records',
      detail: counts
        ? `${plural(counts.patients, 'patient')}, ${plural(counts.patientRecords, 'record')} (notes, vitals, medications, labs, orders, problem lists), plus the General checklist`
        : 'Counting…',
    },
    {
      id: 'tagHistory',
      label: 'Tag history',
      detail: counts ? `${plural(counts.tagHistory, 'event')} of tags being added or removed` : 'Counting…',
    },
    {
      id: 'photos',
      label: 'Photos',
      detail: counts ? `${plural(counts.photos, 'photo')} stored on this device (photos never sync, so each device clears its own)` : 'Counting…',
    },
    {
      id: 'changeLog',
      label: 'Change log',
      detail: counts ? `${plural(counts.changeLog, 'entry', 'entries')} of what your MCP connection changed` : 'Counting…',
    },
    {
      id: 'deletionHistory',
      label: 'Deletion history',
      detail: counts ? `${plural(counts.deletionHistory, 'record')} used to tell other devices what you deleted` : 'Counting…',
    },
  ]

  const runReset = async () => {
    setIsWorking(true)
    setError(null)
    try {
      await onExportBackup()
    } catch {
      setError('The backup could not be made, so nothing was reset.')
      setIsWorking(false)
      return
    }

    try {
      await onReset(selection)
      onOpenChange(false)
    } catch {
      setError('The reset failed. Nothing may have been cleared; check your data before trying again.')
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isWorking) onOpenChange(next) }}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{step === 'choose' ? 'Reset room data' : 'Confirm reset'}</DialogTitle>
        </DialogHeader>

        {step === 'choose' ? (
          <div className='space-y-3'>
            <p className='text-sm text-espresso'>
              Choose what to clear. Your templates, tags, views, custom actions and date/time formats are always kept.
            </p>
            <div className='space-y-2'>
              {rows.map((row) => (
                <label
                  key={row.id}
                  className='flex items-start gap-3 rounded-lg border border-clay/25 bg-warm-ivory px-3 py-2.5'
                >
                  <input
                    type='checkbox'
                    className='mt-0.5 h-4 w-4 shrink-0 accent-action-danger'
                    checked={isChecked(row.id)}
                    disabled={row.id === 'tagHistory' && selection.patients}
                    onChange={() => toggle(row.id)}
                  />
                  <span className='min-w-0'>
                    <span className='block text-sm font-semibold text-espresso'>{row.label}</span>
                    <span className='block text-xs text-clay'>{row.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className='flex justify-end gap-2 pt-1'>
              <Button variant='secondary' onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant='destructive' disabled={!hasSelection || counts === null} onClick={() => setStep('confirm')}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className='space-y-3'>
            <div className='rounded-lg border border-action-danger/30 bg-red-50 px-3 py-2.5 space-y-1.5 text-sm text-espresso'>
              <p>
                A backup file downloads first. Then the selected data is permanently cleared on this device
                {syncEnabled ? ' and in your sync room.' : '.'}
              </p>
              {syncEnabled ? (
                <p>
                  Your other devices and your MCP connection clear the same data the next time they sync.
                  Edits made on a device that hasn't synced since are lost when it does. Every device must
                  be on this version of PUHRR first.
                </p>
              ) : null}
            </div>
            <div className='space-y-1'>
              <Label htmlFor='reset-confirm-word'>Type {CONFIRM_WORD} to confirm</Label>
              <Input
                id='reset-confirm-word'
                value={typedWord}
                onChange={(event) => setTypedWord(event.target.value)}
                placeholder={CONFIRM_WORD}
                autoComplete='off'
                autoCapitalize='characters'
                disabled={isWorking}
              />
            </div>
            {error ? <p className='text-sm text-action-danger'>{error}</p> : null}
            <div className='flex justify-end gap-2 pt-1'>
              <Button variant='secondary' onClick={() => setStep('choose')} disabled={isWorking}>Back</Button>
              <Button
                variant='destructive'
                disabled={isWorking || typedWord.trim() !== CONFIRM_WORD}
                onClick={() => void runReset()}
              >
                {isWorking ? 'Resetting…' : 'Back up and reset'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
